// Prüft Rechte und Ticketablauf gegen eine lokale Supabase-Instanz (npx supabase start).
// Aufruf: SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_KEY=... node scripts/test-rules.mjs
import { createClient } from '@supabase/supabase-js'
import assert from 'node:assert/strict'

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const anon = process.env.SUPABASE_ANON_KEY
const service = process.env.SUPABASE_SERVICE_KEY
const admin = createClient(url, service, { auth: { persistSession: false } })
const run = Date.now()

async function user(name, role) {
  const email = `${name}-${run}@test.local`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'passwort123', email_confirm: true })
  if (error) throw error
  if (role) await admin.from('profiles').update({ role, full_name: name }).eq('id', data.user.id)
  const c = createClient(url, anon, { auth: { persistSession: false } })
  // Optional: Edge Functions direkt (z. B. per `deno run`) statt über das Supabase-Gateway ansprechen
  if (process.env.FUNCTIONS_URL) c.functionsUrl = new URL(process.env.FUNCTIONS_URL)
  const { error: e2 } = await c.auth.signInWithPassword({ email, password: 'passwort123' })
  if (e2) throw e2
  return { id: data.user.id, c }
}

let passed = 0
async function check(label, fn) {
  await fn()
  passed++
  console.log('ok -', label)
}

const qm = await user('qm', 'admin')
const lead = await user('lead', 'teamleiter')
const lead2 = await user('lead2', 'teamleiter')
const worker = await user('worker', 'mitarbeiter')
const other = await user('other', 'mitarbeiter')

await check('Mitarbeiter kann Rolle nicht selbst ändern', async () => {
  const { error } = await worker.c.from('profiles').update({ role: 'admin' }).eq('id', worker.id)
  assert.ok(error)
})

await check('Admin bearbeitet Benutzer, E-Mail nur über die Benutzerverwaltung', async () => {
  const r = await qm.c.from('profiles').update({ full_name: '  Andere Person ', role: 'teamleiter' }).eq('id', other.id).select().single()
  assert.ifError(r.error)
  assert.equal(r.data.full_name, 'Andere Person')
  await qm.c.from('profiles').update({ role: 'mitarbeiter' }).eq('id', other.id)
  const mail = await qm.c.from('profiles').update({ email: 'x@y.de' }).eq('id', other.id)
  assert.match(mail.error.message, /Benutzerverwaltung/)
  const self = await qm.c.from('profiles').update({ active: false }).eq('id', qm.id)
  assert.match(self.error.message, /eigenen Zugang/)
  const own = await worker.c.from('profiles').update({ full_name: 'Neuer Name' }).eq('id', worker.id)
  assert.ifError(own.error)
})

await check('QM-Tickets können nicht mehr angelegt werden', async () => {
  const r = await qm.c.from('tickets').insert({ ticket_type: 'qm', title: 'QM' })
  assert.match(r.error?.message ?? '', /QM-Tickets gibt es nicht mehr/)
})

// --- Einsätze (Restarbeit, Beanstandung, Reparatur) ---
const m1 = await user('monteur1', 'monteur')
const m2 = await user('monteur2', 'monteur')
const m3 = await user('monteur3', 'monteur')
const m4 = await user('monteur4', 'monteur')
const { data: testTeams } = await admin.from('teams').insert([
  { name: `Test A ${run}`, area: 'montage', sort: 900 },
  { name: `Test B ${run}`, area: 'kundendienst', sort: 901 },
]).select().order('sort')
const [T1, T2] = testTeams.map((t) => t.id)
let jobId

await check('Teamleiter besetzt Teams pro Tag, Monteur nicht', async () => {
  let r = await lead2.c.from('team_members').insert([
    { team_id: T1, day: '2026-11-02', installer_id: m1.id },
    { team_id: T1, day: '2026-11-03', installer_id: m1.id },
    { team_id: T2, day: '2026-11-02', installer_id: m2.id },
  ])
  assert.ifError(r.error)
  r = await m1.c.from('team_members').insert({ team_id: T1, day: '2026-11-04', installer_id: m1.id }).select()
  assert.ok(r.error || r.data.length === 0)
  r = await lead2.c.from('team_members').insert({ team_id: T1, day: '2026-11-02', installer_id: worker.id })
  assert.ok(r.error, 'nur Monteure')
})

await check('Monteur ist pro Tag nur in einem Team, höchstens 3 pro Team', async () => {
  let r = await lead2.c.from('team_members').insert({ team_id: T2, day: '2026-11-03', installer_id: m1.id })
  assert.ok(r.error)
  r = await lead2.c.from('team_members').insert([
    { team_id: T2, day: '2026-11-05', installer_id: m1.id },
    { team_id: T2, day: '2026-11-05', installer_id: m2.id },
    { team_id: T2, day: '2026-11-05', installer_id: m3.id },
  ])
  assert.ifError(r.error)
  r = await lead2.c.from('team_members').insert({ team_id: T2, day: '2026-11-05', installer_id: m4.id })
  assert.ok(r.error)
})

await check('Mitarbeiter legt Restarbeit an, Planung wird ignoriert', async () => {
  const { data, error } = await worker.c.from('tickets').insert({
    ticket_type: 'restarbeit', title: 'Griff tauschen', customer_name: 'Müller', site_address: 'Hauptstr. 1',
    team_id: T1, montage_date: '2026-11-02', assigned_to: lead.id,
  }).select().single()
  assert.ifError(error)
  assert.equal(data.status, 'neu')
  assert.equal(data.team_id, null)
  assert.equal(data.assigned_to, null)
  jobId = data.id
})

await check('Nur aktive Teams können eingeplant werden', async () => {
  await admin.from('teams').update({ active: false }).eq('id', T2)
  const { error } = await lead2.c.from('tickets').update({ team_id: T2, montage_date: '2026-11-02' }).eq('id', jobId)
  assert.ok(error)
  await admin.from('teams').update({ active: true }).eq('id', T2)
})

await check('Ohne verantwortlichen Monteur kein Einsatz im Team', async () => {
  const { error } = await lead2.c.from('tickets').update({ team_id: T2, montage_date: '2026-11-09' }).eq('id', jobId)
  assert.match(error?.message ?? '', /kein verantwortlicher Monteur/)
})

await check('Erster Monteur ist verantwortlich, Wechsel und Nachrücken', async () => {
  await lead2.c.from('team_members').insert([
    { team_id: T2, day: '2026-11-10', installer_id: m3.id },
    { team_id: T2, day: '2026-11-10', installer_id: m4.id, lead: true },
  ])
  const crew = async () => (await admin.from('team_members').select('installer_id, lead').eq('team_id', T2).eq('day', '2026-11-10')).data
  let c = await crew()
  assert.deepEqual(c.filter((x) => x.lead).map((x) => x.installer_id), [m3.id])
  let r = await m3.c.rpc('set_team_lead', { p_team_id: T2, p_day: '2026-11-10', p_installer_id: m3.id })
  assert.ok(r.error, 'Monteur darf nicht wechseln')
  r = await lead2.c.rpc('set_team_lead', { p_team_id: T2, p_day: '2026-11-10', p_installer_id: m4.id })
  assert.ifError(r.error)
  c = await crew()
  assert.deepEqual(c.filter((x) => x.lead).map((x) => x.installer_id), [m4.id])
  await lead2.c.from('team_members').delete().match({ team_id: T2, day: '2026-11-10', installer_id: m4.id })
  c = await crew()
  assert.deepEqual(c.filter((x) => x.lead).map((x) => x.installer_id), [m3.id])
})

await check('Teamleiter plant Team und Datum, Status geplant', async () => {
  const { data, error } = await lead2.c.from('tickets').update({ team_id: T1, montage_date: '2026-11-02', montage_time: '08:30' }).eq('id', jobId).select().single()
  assert.ifError(error)
  assert.equal(data.status, 'zugewiesen')
})

await check('Termin beim Kunden anmelden: nur Planer, Felder nicht direkt änderbar', async () => {
  const direct = await lead2.c.from('tickets').update({ appointment_state: 'bestaetigt' }).eq('id', jobId).select().single()
  assert.ifError(direct.error)
  assert.equal(direct.data.appointment_state, 'offen')
  const byInstaller = await m1.c.rpc('announce_appointment', { p_ticket_id: jobId, p_date: '2026-11-02', p_time: '08:30', p_told_by: m1.id })
  assert.ok(byInstaller.error)
  const tooEarly = await lead2.c.rpc('confirm_appointment', { p_ticket_id: jobId })
  assert.match(tooEarly.error.message, /zuerst beim Kunden angemeldet/)
  const r = await lead2.c.rpc('announce_appointment', { p_ticket_id: jobId, p_date: '2026-11-02', p_time: '08:30', p_told_by: lead.id, p_note: ' telefonisch ' })
  assert.ifError(r.error)
  const { data } = await qm.c.from('tickets').select('*').eq('id', jobId).single()
  assert.equal(data.appointment_state, 'angemeldet')
  assert.equal(data.appointment_told_by, lead.id)
  assert.equal(data.appointment_announced_by, lead2.id)
  assert.equal(data.appointment_time, '08:30:00')
  assert.equal(data.appointment_note, 'telefonisch')
})

await check('Kunde bestätigt Termin, Verschieben hebt die Anmeldung auf', async () => {
  assert.ifError((await lead2.c.rpc('confirm_appointment', { p_ticket_id: jobId })).error)
  let { data } = await qm.c.from('tickets').select('*').eq('id', jobId).single()
  assert.equal(data.appointment_state, 'bestaetigt')
  assert.equal(data.appointment_confirmed_by, lead2.id)
  await lead2.c.from('tickets').update({ montage_time: '10:00' }).eq('id', jobId)
  ;({ data } = await qm.c.from('tickets').select('*').eq('id', jobId).single())
  assert.equal(data.appointment_state, 'offen')
  assert.equal(data.appointment_date, '2026-11-02')
  const ev = await qm.c.from('ticket_events').select('kind, details').eq('ticket_id', jobId).like('kind', 'termin_%').order('id')
  assert.deepEqual(ev.data.map((e) => e.kind), ['termin_angemeldet', 'termin_bestaetigt', 'termin_zurueckgesetzt'])
  assert.match(ev.data[0].details, /02\.11\.2026 08:30 Uhr, mitgeteilt von lead, telefonisch/)
  assert.match(ev.data[2].details, /von 02\.11\.2026 08:30 Uhr auf 02\.11\.2026 10:00 Uhr/)
  const last = await qm.c.from('ticket_events').select('kind').eq('ticket_id', jobId).order('id', { ascending: false }).limit(1).single()
  assert.equal(last.data.kind, 'termin_zurueckgesetzt')
  await lead2.c.from('tickets').update({ montage_time: '08:30' }).eq('id', jobId)
  assert.ifError((await lead2.c.rpc('announce_appointment', { p_ticket_id: jobId, p_date: '2026-11-02', p_time: '08:30', p_told_by: lead2.id })).error)
})

await check('Monteur sieht nur Einsätze seines Teams am jeweiligen Tag', async () => {
  const other = await m1.c.from('tickets').select('id').eq('id', jobId)
  assert.equal(other.data.length, 1)
  // m3 ist am 02.11. in keinem Team, am 05.11. in T2
  const m3view = await m3.c.from('tickets').select('id').eq('id', jobId)
  assert.equal(m3view.data.length, 0)
})

await check('Zweiter Monteur im Team sieht den Einsatz, nach dem Austragen nicht mehr', async () => {
  await lead2.c.from('team_members').insert({ team_id: T1, day: '2026-11-02', installer_id: m4.id })
  let v = await m4.c.from('tickets').select('id').eq('id', jobId)
  assert.equal(v.data.length, 1)
  await lead2.c.from('team_members').delete().match({ team_id: T1, day: '2026-11-02', installer_id: m4.id })
  v = await m4.c.from('tickets').select('id').eq('id', jobId)
  assert.equal(v.data.length, 0)
})

await check('Monteur sieht nur eigene Einsätze', async () => {
  const own = await m1.c.from('tickets').select('id').eq('id', jobId)
  assert.equal(own.data.length, 1)
  const foreign = await m2.c.from('tickets').select('id').eq('id', jobId)
  assert.equal(foreign.data.length, 0)
  const qmTicket = await m1.c.from('tickets').select('id').eq('ticket_type', 'qm')
  assert.equal(qmTicket.data.length, 0)
})

await check('Letzten Monteur nicht austragen, solange das Team Einsätze hat', async () => {
  const { error } = await lead2.c.from('team_members').delete().match({ team_id: T1, day: '2026-11-02', installer_id: m1.id })
  assert.ok(error)
  const { data } = await admin.from('team_members').select('installer_id').eq('team_id', T1).eq('day', '2026-11-02')
  assert.equal(data.length, 1)
})

await check('Monteur kann Termin nicht verschieben', async () => {
  const { error } = await m1.c.from('tickets').update({ montage_date: '2026-11-09' }).eq('id', jobId)
  assert.ok(error)
})

await check('Bereich: Restarbeit ist standardmäßig Montage, Monteur kann ihn nicht ändern', async () => {
  const { data } = await qm.c.from('tickets').select('service_area').eq('id', jobId).single()
  assert.equal(data.service_area, 'montage')
  await m1.c.from('tickets').update({ service_area: 'kundendienst' }).eq('id', jobId)
  const { data: after } = await qm.c.from('tickets').select('service_area').eq('id', jobId).single()
  assert.equal(after.service_area, 'montage')
  const r = await lead2.c.from('tickets').update({ service_area: 'kundendienst' }).eq('id', jobId).select().single()
  assert.ifError(r.error)
  assert.equal(r.data.service_area, 'kundendienst')
})

await check('Unterschrift braucht Namen und richtigen Ablageort', async () => {
  let r = await m1.c.from('tickets').update({ signature_path: `${jobId}/unterschrift-a.png` }).eq('id', jobId)
  assert.ok(r.error)
  r = await m1.c.from('tickets').update({ signature_path: `999999/unterschrift-a.png`, signer_name: 'Herr Müller' }).eq('id', jobId)
  assert.ok(r.error)
})

await check('Monteur speichert Kundenunterschrift', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex')
  const path = `${jobId}/unterschrift-test.png`
  const up = await m1.c.storage.from('ticket-photos').upload(path, png, { contentType: 'image/png' })
  assert.ifError(up.error)
  const { data, error } = await m1.c.from('tickets').update({ signature_path: path, signer_name: ' Herr Müller ' }).eq('id', jobId).select().single()
  assert.ifError(error)
  assert.equal(data.signer_name, 'Herr Müller')
  assert.ok(data.signed_at)
  const { data: photos } = await m1.c.from('ticket_photos').select('id').eq('ticket_id', jobId)
  assert.equal(photos.length, 0)
})

await check('Kunde wünscht Bericht per E-Mail, Adresse wird geprüft', async () => {
  let r = await m1.c.from('tickets').update({ report_by_email: true }).eq('id', jobId)
  assert.ok(r.error)
  r = await m1.c.from('tickets').update({ report_by_email: true, customer_email: 'keine-adresse' }).eq('id', jobId)
  assert.ok(r.error)
  const ok = await m1.c.from('tickets').update({ report_by_email: true, customer_email: ' Mueller@Example.de ' }).eq('id', jobId).select().single()
  assert.ifError(ok.error)
  assert.equal(ok.data.customer_email, 'mueller@example.de')
})

await check('Erledigt nur mit Arbeitsbericht', async () => {
  const { error } = await m1.c.from('tickets').update({ status: 'abgeschlossen' }).eq('id', jobId)
  assert.ok(error)
})

await check('Teamleiter kann Einsatz nicht als erledigt melden', async () => {
  const { error } = await lead2.c.from('tickets').update({ work_report: 'x', status: 'abgeschlossen' }).eq('id', jobId)
  assert.ok(error)
})

await check('Monteur lädt Foto hoch und meldet erledigt', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex')
  const up = await m1.c.storage.from('ticket-photos').upload(`${jobId}/m.png`, png, { contentType: 'image/png' })
  assert.ifError(up.error)
  const { data, error } = await m1.c.from('tickets').update({ work_report: 'Griff getauscht', status: 'abgeschlossen' }).eq('id', jobId).select().single()
  assert.ifError(error)
  assert.equal(data.status, 'abgeschlossen')
  assert.ok(data.closed_at)
})

await check('Unterschrift nach Erledigt für Monteur gesperrt', async () => {
  const { error } = await m1.c.from('tickets').update({ signature_path: null }).eq('id', jobId)
  assert.ok(error)
})

await check('Erledigter Einsatz ist für Monteur gesperrt, Admin öffnet wieder', async () => {
  const { error } = await m1.c.from('tickets').update({ work_report: 'y' }).eq('id', jobId)
  assert.ok(error)
  const r = await qm.c.from('tickets').update({ status: 'zugewiesen' }).eq('id', jobId).select().single()
  assert.ifError(r.error)
  assert.equal(r.data.status, 'zugewiesen')
})

await check('Planung entfernen setzt Einsatz auf ungeplant', async () => {
  const { data, error } = await qm.c.from('tickets').update({ team_id: null, montage_date: null }).eq('id', jobId).select().single()
  assert.ifError(error)
  assert.equal(data.status, 'neu')
})

await check('Einsatz-Verlauf enthält Planung und Bericht', async () => {
  const { data } = await qm.c.from('ticket_events').select('kind').eq('ticket_id', jobId)
  const kinds = data.map((e) => e.kind)
  for (const k of ['erstellt', 'eingeplant', 'bericht', 'status', 'unterschrift', 'bereich']) assert.ok(kinds.includes(k), k)
})

// --- Positionen ---
let posJob, posIds
await check('Ersteller legt Positionen an, solange ungeplant', async () => {
  const { data: job } = await worker.c.from('tickets').insert({ ticket_type: 'beanstandung', title: 'Mehrere Mängel' }).select().single()
  posJob = job.id
  const { data, error } = await worker.c.from('ticket_positions').insert([
    { ticket_id: posJob, sort: 0, position_number: ' 10 ', description: 'Tür einstellen', state: 'erledigt' },
    { ticket_id: posJob, sort: 1, position_number: '20', description: 'Dichtung tauschen' },
  ]).select().order('sort')
  assert.ifError(error)
  assert.equal(data[0].position_number, '10')
  assert.equal(data[0].state, 'offen')
  posIds = data.map((p) => p.id)
  const empty = await worker.c.from('ticket_positions').insert({ ticket_id: posJob, position_number: ' ', description: '' })
  assert.ok(empty.error)
})

await check('Nach Planung kann Ersteller keine Positionen mehr ändern, Teamleiter schon', async () => {
  await lead.c.from('tickets').update({ team_id: T1, montage_date: '2026-11-03' }).eq('id', posJob)
  const r = await worker.c.from('ticket_positions').insert({ ticket_id: posJob, description: 'x' })
  assert.ok(r.error)
  const u = await lead.c.from('ticket_positions').insert({ ticket_id: posJob, sort: 2, position_number: '30', description: 'Silikon' }).select().single()
  assert.ifError(u.error)
  posIds.push(u.data.id)
})

await check('Fremder Monteur sieht Positionen nicht', async () => {
  const { data } = await m2.c.from('ticket_positions').select('id').eq('ticket_id', posJob)
  assert.equal(data.length, 0)
  const r = await m2.c.from('ticket_positions').update({ state: 'erledigt' }).eq('id', posIds[0]).select()
  assert.ok(r.error || r.data.length === 0)
})

await check('Monteur hakt ab, Erledigt-Vermerk wird gesetzt', async () => {
  const { data, error } = await m1.c.from('ticket_positions').update({ state: 'erledigt', done_by: lead.id }).eq('id', posIds[0]).select().single()
  assert.ifError(error)
  assert.equal(data.state, 'erledigt')
  assert.equal(data.done_by, m1.id)
  assert.ok(data.done_at)
})

await check('Monteur kann Text nicht ändern und nichts löschen', async () => {
  const r = await m1.c.from('ticket_positions').update({ description: 'anders' }).eq('id', posIds[1])
  assert.ok(r.error)
  const d = await m1.c.from('ticket_positions').delete().eq('id', posIds[1]).select()
  assert.ok(d.error || d.data.length === 0)
  const { data } = await qm.c.from('ticket_positions').select('id').eq('ticket_id', posJob)
  assert.equal(data.length, 3)
})

await check('Monteur ergänzt Position im eigenen Einsatz (Verlauf), fremder Monteur nicht', async () => {
  const { data, error } = await m1.c.from('ticket_positions').insert({ ticket_id: posJob, sort: 3, position_number: '4', description: 'Zusatz vor Ort' }).select().single()
  assert.ifError(error)
  assert.equal(data.state, 'offen')
  const r = await m2.c.from('ticket_positions').insert({ ticket_id: posJob, sort: 4, description: 'fremd' })
  assert.ok(r.error)
  const { data: ev } = await qm.c.from('ticket_events').select('details').eq('ticket_id', posJob).eq('kind', 'position_ergaenzt')
  assert.equal(ev.length, 1)
  assert.match(ev[0].details, /Zusatz vor Ort/)
  const del = await lead.c.from('ticket_positions').delete().eq('id', data.id)
  assert.ifError(del.error)
})

await check('Monteur hängt Foto an Position, fremde Position wird abgelehnt', async () => {
  const ok = await m1.c.from('ticket_photos').insert({ ticket_id: posJob, position_id: posIds[1], storage_path: `${posJob}/pos-${run}.jpg` }).select().single()
  assert.ifError(ok.error)
  assert.equal(ok.data.position_id, posIds[1])
  const { data: other } = await qm.c.from('tickets').insert({ ticket_type: 'restarbeit', title: 'anders' }).select().single()
  const { data: op } = await qm.c.from('ticket_positions').insert({ ticket_id: other.id, description: 'x' }).select().single()
  const bad = await m1.c.from('ticket_photos').insert({ ticket_id: posJob, position_id: op.id, storage_path: `${posJob}/bad-${run}.jpg` })
  assert.ok(bad.error)
})

await check('Position löschen: Fotos bleiben am Auftrag', async () => {
  const { data: pos } = await lead.c.from('ticket_positions').insert({ ticket_id: posJob, sort: 9, description: 'weg' }).select().single()
  const ph = await lead.c.from('ticket_photos').insert({ ticket_id: posJob, position_id: pos.id, storage_path: `${posJob}/weg-${run}.jpg` }).select().single()
  assert.ifError(ph.error)
  const del = await lead.c.from('ticket_positions').delete().eq('id', pos.id)
  assert.ifError(del.error)
  const { data } = await qm.c.from('ticket_photos').select('position_id').eq('id', ph.data.id).single()
  assert.equal(data.position_id, null)
})

await check('Erledigt melden erst, wenn keine Position mehr offen ist', async () => {
  const r = await m1.c.from('tickets').update({ work_report: 'fertig', status: 'abgeschlossen' }).eq('id', posJob)
  assert.ok(r.error)
  const a = await qm.c.from('tickets').update({ status: 'abgeschlossen' }).eq('id', posJob)
  assert.ok(a.error)
})

await check('Nicht erledigt nur mit Begründung', async () => {
  const r = await m1.c.from('ticket_positions').update({ state: 'nicht_erledigt', reason: '  ' }).eq('id', posIds[1])
  assert.ok(r.error)
  const ok = await m1.c.from('ticket_positions').update({ state: 'nicht_erledigt', reason: ' Ersatzteil fehlt ' }).eq('id', posIds[1]).select().single()
  assert.ifError(ok.error)
  assert.equal(ok.data.reason, 'Ersatzteil fehlt')
  assert.equal(ok.data.done_by, m1.id)
  const back = await m1.c.from('ticket_positions').update({ state: 'erledigt', reason: 'x' }).eq('id', posIds[2]).select().single()
  assert.ifError(back.error)
  assert.equal(back.data.reason, '')
})

await check('Monteur kann Position nicht zurück auf offen setzen, Teamleiter schon', async () => {
  const r = await m1.c.from('ticket_positions').update({ state: 'offen' }).eq('id', posIds[2])
  assert.ok(r.error)
  const t = await lead.c.from('ticket_positions').update({ state: 'offen' }).eq('id', posIds[2]).select().single()
  assert.ifError(t.error)
  assert.equal(t.data.done_by, null)
  const again = await m1.c.from('ticket_positions').update({ state: 'erledigt' }).eq('id', posIds[2]).select().single()
  assert.ifError(again.error)
})

await check('Nach Erledigt sind Positionen für Monteur und Teamleiter gesperrt', async () => {
  const r = await m1.c.from('tickets').update({ work_report: 'fertig', status: 'abgeschlossen' }).eq('id', posJob).select().single()
  assert.ifError(r.error)
  const a = await m1.c.from('ticket_positions').update({ state: 'erledigt' }).eq('id', posIds[1]).select()
  assert.ok(a.error || a.data.length === 0)
  const b = await lead.c.from('ticket_positions').update({ description: 'neu' }).eq('id', posIds[1]).select()
  assert.ok(b.error || b.data.length === 0)
  const c = await qm.c.from('ticket_positions').update({ state: 'erledigt' }).eq('id', posIds[1]).select().single()
  assert.ifError(c.error)
  assert.equal(c.data.done_by, qm.id)
})

// --- Löschanträge ---
let delId
await check('Mitarbeiter kann Ticket nicht direkt löschen', async () => {
  const { data } = await worker.c.from('tickets').insert({ title: 'doppelt' }).select().single()
  delId = data.id
  await worker.c.from('tickets').delete().eq('id', delId)
  const { data: still } = await qm.c.from('tickets').select('id').eq('id', delId)
  assert.equal(still.length, 1)
})

await check('Fremder Mitarbeiter kann keine Löschung beantragen', async () => {
  const { error } = await other.c.from('deletion_requests').insert({ ticket_id: delId, reason: 'x' })
  assert.ok(error)
})

await check('Löschantrag braucht Begründung', async () => {
  const { error } = await worker.c.from('deletion_requests').insert({ ticket_id: delId, reason: '  ' })
  assert.ok(error)
})

await check('Ersteller beantragt, QM lehnt ab', async () => {
  let r = await worker.c.from('deletion_requests').insert({ ticket_id: delId, reason: 'doppelt angelegt' })
  assert.ifError(r.error)
  r = await qm.c.from('deletion_requests').delete().eq('ticket_id', delId).select()
  assert.ifError(r.error)
  assert.equal(r.data.length, 1)
  const { data } = await worker.c.from('ticket_events').select('kind').eq('ticket_id', delId)
  const kinds = data.map((e) => e.kind)
  assert.ok(kinds.includes('loeschantrag') && kinds.includes('loeschantrag_abgelehnt'))
})

await check('Antragsteller kann zurückziehen, Teamleiter nicht fremden Antrag', async () => {
  await worker.c.from('deletion_requests').insert({ ticket_id: delId, reason: 'doppelt' })
  const bad = await lead.c.from('deletion_requests').delete().eq('ticket_id', delId).select()
  assert.equal(bad.data.length, 0)
  const ok = await worker.c.from('deletion_requests').delete().eq('ticket_id', delId).select()
  assert.equal(ok.data.length, 1)
})

await check('QM gibt Löschung frei', async () => {
  await worker.c.from('deletion_requests').insert({ ticket_id: delId, reason: 'doppelt' })
  const r = await qm.c.from('tickets').delete().eq('id', delId).select()
  assert.ifError(r.error)
  assert.equal(r.data.length, 1)
})

// --- Berechnung Reparaturauftrag ---
let repId, repPos
await check('Erledigter Reparaturauftrag geht automatisch zur Berechnung', async () => {
  const { data: rep } = await lead2.c.from('tickets')
    .insert({ ticket_type: 'reparatur', title: 'Motor tauschen', team_id: T1, montage_date: '2026-11-03' }).select().single()
  repId = rep.id
  assert.equal(rep.billing_state, 'keine')
  const { data: pos } = await lead2.c.from('ticket_positions')
    .insert([{ ticket_id: repId, sort: 0, description: 'Motor', price: 99 }, { ticket_id: repId, sort: 1, description: 'Anfahrt' }]).select().order('sort')
  repPos = pos.map((p) => p.id)
  assert.equal(pos[0].price, null)
  const early = await lead2.c.rpc('set_position_price', { p_position_id: repPos[0], p_price: 10 })
  assert.match(early.error.message, /zur Berechnung/)
  await m1.c.from('ticket_positions').update({ state: 'erledigt' }).in('id', repPos)
  const r = await m1.c.from('tickets').update({ work_report: 'getauscht', status: 'abgeschlossen' }).eq('id', repId).select().single()
  assert.ifError(r.error)
  assert.equal(r.data.billing_state, 'zur_berechnung')
  const direct = await qm.c.from('tickets').update({ billing_state: 'berechnet' }).eq('id', repId).select().single()
  assert.equal(direct.data.billing_state, 'zur_berechnung')
})

await check('Preise nur durch Planer, Abschluss erst mit allen Preisen', async () => {
  const byInstaller = await m1.c.rpc('set_position_price', { p_position_id: repPos[0], p_price: 10 })
  assert.ok(byInstaller.error)
  const directPrice = await qm.c.from('ticket_positions').update({ price: 5 }).eq('id', repPos[0]).select().single()
  assert.equal(directPrice.data.price, null)
  assert.ifError((await lead2.c.rpc('set_position_price', { p_position_id: repPos[0], p_price: 189.999 })).error)
  const neg = await lead2.c.rpc('set_position_price', { p_position_id: repPos[1], p_price: -1 })
  assert.ok(neg.error)
  const notYet = await lead2.c.rpc('finish_billing', { p_ticket_id: repId })
  assert.match(notYet.error.message, /allen Positionen einen Preis/)
  assert.ifError((await lead2.c.rpc('set_position_price', { p_position_id: repPos[1], p_price: 0 })).error)
  assert.ifError((await lead2.c.rpc('finish_billing', { p_ticket_id: repId })).error)
  const { data } = await qm.c.from('tickets').select('billing_state, billed_by').eq('id', repId).single()
  assert.equal(data.billing_state, 'berechnet')
  assert.equal(data.billed_by, lead2.id)
  const { data: p0 } = await qm.c.from('ticket_positions').select('price').eq('id', repPos[0]).single()
  assert.equal(p0.price, 190)
  const ev = await qm.c.from('ticket_events').select('details').eq('ticket_id', repId).eq('kind', 'berechnet').order('id').limit(1).single()
  assert.equal(ev.data.details, 'Summe 190,00 €')
  const locked = await lead2.c.rpc('set_position_price', { p_position_id: repPos[0], p_price: 1 })
  assert.ok(locked.error)
})

await check('Nur Admin öffnet Berechnung wieder, andere Einsätze haben keine Berechnung', async () => {
  assert.ok((await lead2.c.rpc('reopen_billing', { p_ticket_id: repId })).error)
  assert.ifError((await qm.c.rpc('reopen_billing', { p_ticket_id: repId })).error)
  let { data } = await qm.c.from('tickets').select('billing_state').eq('id', repId).single()
  assert.equal(data.billing_state, 'zur_berechnung')
  // Menge und Einheit: Betrag = Menge × Einzelpreis
  const direct = await qm.c.from('ticket_positions').update({ quantity: 9, unit: 'kg' }).eq('id', repPos[1]).select().single()
  assert.equal(direct.data.quantity, 1)
  assert.equal(direct.data.unit, 'Stk')
  assert.ok((await lead2.c.rpc('set_position_billing', { p_position_id: repPos[1], p_quantity: 0, p_unit: 'Std', p_price: 40 })).error)
  assert.ok((await lead2.c.rpc('set_position_billing', { p_position_id: repPos[1], p_quantity: 1, p_unit: ' ', p_price: 40 })).error)
  assert.ifError((await lead2.c.rpc('set_position_billing', { p_position_id: repPos[1], p_quantity: 2.5, p_unit: ' Std ', p_price: 40 })).error)
  const { data: p1 } = await qm.c.from('ticket_positions').select('quantity, unit, price').eq('id', repPos[1]).single()
  assert.deepEqual(p1, { quantity: 2.5, unit: 'Std', price: 40 })
  assert.ifError((await lead2.c.rpc('finish_billing', { p_ticket_id: repId })).error)
  const ev = await qm.c.from('ticket_events').select('details').eq('ticket_id', repId).eq('kind', 'berechnet').order('id', { ascending: false }).limit(1).single()
  assert.equal(ev.data.details, 'Summe 290,00 €')
  assert.ifError((await qm.c.rpc('reopen_billing', { p_ticket_id: repId })).error)
  await qm.c.from('tickets').update({ status: 'zugewiesen' }).eq('id', repId)
  ;({ data } = await qm.c.from('tickets').select('billing_state').eq('id', repId).single())
  assert.equal(data.billing_state, 'keine')
  const { data: closedOther } = await qm.c.from('tickets').select('billing_state').neq('ticket_type', 'reparatur').eq('status', 'abgeschlossen')
  assert.ok(closedOther.every((t) => t.billing_state === 'keine'))
})

// --- Artikel ---
await check('Nur Admin pflegt Artikel, alle können sie sehen', async () => {
  const denied = await lead.c.from('articles').insert({ description: 'Anfahrt', price: 45 }).select()
  assert.ok(denied.error)
  const { data: art, error } = await qm.c.from('articles').insert({ article_number: ` A-${run} `, description: ' Anfahrtspauschale ', unit: 'pauschal', price: 45 }).select().single()
  assert.ifError(error)
  assert.equal(art.article_number, `A-${run}`)
  assert.equal(art.description, 'Anfahrtspauschale')
  const dup = await qm.c.from('articles').insert({ article_number: `a-${run}`, description: 'doppelt' })
  assert.ok(dup.error)
  const seen = await worker.c.from('articles').select('id').eq('id', art.id)
  assert.equal(seen.data.length, 1)
  const upd = await lead.c.from('articles').update({ price: 1 }).eq('id', art.id).select()
  assert.ok(upd.error || upd.data.length === 0)
  globalThis.articleId = art.id
})

await check('Position aus Artikel übernimmt Einheit und Preis', async () => {
  const { data: t } = await worker.c.from('tickets').insert({ ticket_type: 'reparatur', title: 'Artikel-Test' }).select().single()
  const { data: pos, error } = await worker.c.from('ticket_positions')
    .insert({ ticket_id: t.id, description: 'Anfahrtspauschale', article_id: globalThis.articleId, price: 1, unit: 'kg' }).select().single()
  assert.ifError(error)
  assert.equal(pos.unit, 'pauschal')
  assert.equal(pos.price, 45)
  await qm.c.from('articles').update({ active: false }).eq('id', globalThis.articleId)
  const inactive = await worker.c.from('ticket_positions').insert({ ticket_id: t.id, description: 'x', article_id: globalThis.articleId })
  assert.match(inactive.error.message, /nicht mehr aktiv/)
})

// --- Zeiterfassung ---
await check('Monteur startet und stoppt Zeiten, nur eine läuft, fremde Monteure nicht', async () => {
  const { data: job } = await lead2.c.from('tickets')
    .insert({ ticket_type: 'reparatur', title: 'Zeiten', team_id: T1, montage_date: '2026-11-03' }).select().single()
  globalThis.timeJob = job.id
  const other = await m3.c.rpc('start_time_entry', { p_ticket_id: job.id, p_kind: 'arbeit' })
  assert.match(other.error.message, /Monteure des eingeplanten Teams/)
  const direct = await m1.c.from('time_entries').insert({ ticket_id: job.id, installer_id: m1.id, kind: 'arbeit' })
  assert.ok(direct.error)
  const notIn = await m1.c.rpc('start_time_entry', { p_ticket_id: job.id, p_kind: 'arbeit' })
  assert.match(notIn.error.message, /zuerst oben die Zeiterfassung starten/)
  assert.ifError((await m1.c.rpc('clock_in')).error)
  assert.ifError((await m1.c.rpc('start_time_entry', { p_ticket_id: job.id, p_kind: 'fahrt' })).error)
  assert.ifError((await m1.c.rpc('start_time_entry', { p_ticket_id: job.id, p_kind: 'arbeit' })).error)
  const { data } = await m1.c.from('time_entries').select('kind, ended_at').eq('ticket_id', job.id).order('id')
  assert.deepEqual(data.map((e) => [e.kind, e.ended_at !== null]), [['fahrt', true], ['arbeit', false]])
  const fake = await m1.c.from('time_entries').update({ started_at: '2026-01-01T00:00:00Z' }).eq('ticket_id', job.id).select()
  assert.ok(fake.error || fake.data.length === 0)
})

await check('Erledigt melden stoppt laufende Zeit, Planer korrigiert, nur Admin löscht', async () => {
  const job = globalThis.timeJob
  await m1.c.from('tickets').update({ work_report: 'fertig', status: 'abgeschlossen' }).eq('id', job)
  const { data: [e] } = await qm.c.from('time_entries').select('*').eq('ticket_id', job).eq('kind', 'arbeit')
  assert.ok(e.ended_at)
  const late = await m1.c.rpc('start_time_entry', { p_ticket_id: job, p_kind: 'arbeit' })
  assert.ok(late.error)
  const fix = await lead2.c.from('time_entries').update({ started_at: '2026-10-20T07:00:00Z', ended_at: '2026-10-20T09:30:00Z' }).eq('id', e.id).select().single()
  assert.ifError(fix.error)
  assert.equal(fix.data.edited_by, lead2.id)
  const bad = await lead2.c.from('time_entries').update({ ended_at: '2026-10-20T06:00:00Z' }).eq('id', e.id)
  assert.ok(bad.error)
  const del = await lead2.c.from('time_entries').delete().eq('id', e.id).select()
  assert.equal(del.data.length, 0)
  assert.equal((await qm.c.from('time_entries').delete().eq('id', e.id).select()).data.length, 1)
})

await check('Stempeluhr: alle Mitarbeiter, eine laufende Zeit, Ausstempeln stoppt Auftragszeit', async () => {
  assert.ifError((await worker.c.rpc('clock_in')).error)
  assert.ifError((await worker.c.rpc('clock_out')).error)
  const { data: a1 } = await m1.c.rpc('clock_in')
  const { data: a2 } = await m1.c.rpc('clock_in')
  assert.equal(a1, a2)
  const direct = await m1.c.from('attendance').insert({ installer_id: m1.id })
  assert.ok(direct.error)
  const fake = await m1.c.from('attendance').update({ started_at: '2026-01-01T00:00:00Z' }).eq('id', a1).select()
  assert.ok(fake.error || fake.data.length === 0)
  const { data: job } = await lead2.c.from('tickets')
    .insert({ ticket_type: 'reparatur', title: 'Stempel', team_id: T1, montage_date: '2026-11-02' }).select().single()
  assert.ifError((await m1.c.rpc('start_time_entry', { p_ticket_id: job.id, p_kind: 'arbeit' })).error)
  assert.ifError((await m1.c.rpc('clock_out')).error)
  const { data: te } = await qm.c.from('time_entries').select('ended_at').eq('ticket_id', job.id)
  assert.ok(te.every((e) => e.ended_at))
  const { data: att } = await m1.c.from('attendance').select('ended_at').eq('id', a1).single()
  assert.ok(att.ended_at)
  assert.equal((await m2.c.from('attendance').select('id').eq('id', a1)).data.length, 0)
})

await check('Zeit nachtragen nur mit Grund und Genehmigung des Vorgesetzten, nur Admin löscht', async () => {
  await qm.c.from('profiles').update({ supervisor_id: lead2.id }).eq('id', m2.id)
  const direct = await lead.c.from('attendance').insert({ installer_id: m2.id, started_at: '2026-10-20T06:00:00Z', ended_at: '2026-10-20T14:30:00Z' })
  assert.ok(direct.error, 'direktes Nachtragen ist gesperrt')
  const req = (c, args) => c.rpc('request_attendance_change', { p_user: m2.id, p_attendance_id: null, p_reason: '', ...args })
  let r = await req(m2.c, { p_start: '2026-10-20T06:00:00Z', p_end: '2026-10-20T14:30:00Z' })
  assert.match(r.error?.message ?? '', /Grund/)
  r = await req(m2.c, { p_start: '2026-10-20T06:00:00Z', p_end: '2026-10-20T14:30:00Z', p_reason: 'Stempeln vergessen' })
  assert.equal(r.data, 'beantragt')
  const { data: pending } = await m2.c.from('attendance_requests').select('id').eq('user_id', m2.id).eq('state', 'beantragt').single()
  assert.equal((await qm.c.from('attendance').select('id').eq('installer_id', m2.id).gte('started_at', '2026-10-20').lt('started_at', '2026-10-21')).data.length, 0)
  r = await m2.c.rpc('decide_attendance_change', { p_id: pending.id, p_approve: true })
  assert.match(r.error?.message ?? '', /Vorgesetzte/)
  r = await lead.c.rpc('decide_attendance_change', { p_id: pending.id, p_approve: true })
  assert.match(r.error?.message ?? '', /Vorgesetzte/)
  r = await lead2.c.rpc('decide_attendance_change', { p_id: pending.id, p_approve: true })
  assert.ifError(r.error)
  const { data: added } = await qm.c.from('attendance').select('*').eq('installer_id', m2.id).gte('started_at', '2026-10-20').lt('started_at', '2026-10-21').single()
  assert.equal(added.note, 'Stempeln vergessen')
  // Vorgesetzter korrigiert selbst: gilt sofort
  r = await req(lead2.c, { p_attendance_id: added.id, p_start: '2026-10-20T06:00:00Z', p_end: '2026-10-20T15:00:00Z', p_reason: 'Ende korrigiert' })
  assert.equal(r.data, 'genehmigt')
  assert.equal((await qm.c.from('attendance').select('ended_at').eq('id', added.id).single()).data.ended_at, '2026-10-20T15:00:00+00:00')
  // Überschneidung wird beim Genehmigen abgelehnt, eigener Antrag kann zurückgezogen werden
  r = await req(m2.c, { p_start: '2026-10-20T14:00:00Z', p_end: '2026-10-20T16:00:00Z', p_reason: 'doppelt' })
  const { data: dup } = await m2.c.from('attendance_requests').select('id').eq('user_id', m2.id).eq('state', 'beantragt').single()
  r = await lead2.c.rpc('decide_attendance_change', { p_id: dup.id, p_approve: true })
  assert.match(r.error?.message ?? '', /überschneidet/)
  assert.ifError((await m2.c.rpc('cancel_attendance_change', { p_id: dup.id })).error)
  // Eigene Zeiten des Vorgesetzten brauchen auch eine Genehmigung
  r = await lead2.c.rpc('request_attendance_change', { p_user: lead2.id, p_attendance_id: null, p_start: '2026-10-20T06:00:00Z', p_end: '2026-10-20T07:00:00Z', p_reason: 'Termin' })
  assert.equal(r.data, 'beantragt')
  assert.ifError((await lead.c.rpc('clock_in')).error)
  assert.ifError((await lead.c.rpc('clock_out')).error)
  assert.equal((await lead.c.from('attendance').delete().eq('id', added.id).select()).data.length, 0)
  assert.equal((await qm.c.from('attendance').delete().eq('id', added.id).select()).data.length, 1)
  await qm.c.from('profiles').update({ supervisor_id: null }).eq('id', m2.id)
})

// --- Benutzerverwaltung (Edge Function admin-users) ---
if (process.env.SKIP_FUNCTIONS !== '1') {
  const newMail = `neu-${run}@test.local`
  await check('Mitarbeiter darf keine Benutzer anlegen', async () => {
    const { error } = await worker.c.functions.invoke('admin-users', { body: { action: 'create', email: newMail, password: 'passwort123', role: 'admin' } })
    assert.ok(error)
    assert.equal(error.context.status, 403)
  })

  await check('QM legt Teamleiter an, Login klappt', async () => {
    const { data, error } = await qm.c.functions.invoke('admin-users', { body: { action: 'create', email: newMail, full_name: 'Neu Leiter', password: 'Start-1234', role: 'teamleiter' } })
    assert.ifError(error)
    const { data: prof } = await admin.from('profiles').select('role, full_name').eq('id', data.id).single()
    assert.equal(prof.role, 'teamleiter')
    assert.equal(prof.full_name, 'Neu Leiter')
    const c = createClient(url, anon, { auth: { persistSession: false } })
    const login = await c.auth.signInWithPassword({ email: newMail, password: 'Start-1234' })
    assert.ifError(login.error)
  })

  await check('Doppelte E-Mail wird abgelehnt', async () => {
    const { error } = await qm.c.functions.invoke('admin-users', { body: { action: 'create', email: newMail, password: 'passwort123' } })
    assert.ok(error)
    assert.match((await error.context.json()).error, /bereits/)
  })

  await check('QM setzt Passwort neu', async () => {
    const { error } = await qm.c.functions.invoke('admin-users', { body: { action: 'set_password', user_id: worker.id, password: 'Neu-9999-Pass' } })
    assert.ifError(error)
    const c = createClient(url, anon, { auth: { persistSession: false } })
    const login = await c.auth.signInWithPassword({ email: `worker-${run}@test.local`, password: 'Neu-9999-Pass' })
    assert.ifError(login.error)
  })

  await check('QM ändert Login-E-Mail, Login mit neuer Adresse klappt', async () => {
    const changed = `geaendert-${run}@test.local`
    const bad = await qm.c.functions.invoke('admin-users', { body: { action: 'update_email', user_id: other.id, email: newMail } })
    assert.match((await bad.error.context.json()).error, /bereits/)
    const denied = await lead.c.functions.invoke('admin-users', { body: { action: 'update_email', user_id: other.id, email: changed } })
    assert.equal(denied.error.context.status, 403)
    const { error } = await qm.c.functions.invoke('admin-users', { body: { action: 'update_email', user_id: other.id, email: ` ${changed.toUpperCase()} ` } })
    assert.ifError(error)
    const { data: prof } = await admin.from('profiles').select('email').eq('id', other.id).single()
    assert.equal(prof.email, changed)
    const c = createClient(url, anon, { auth: { persistSession: false } })
    assert.ifError((await c.auth.signInWithPassword({ email: changed, password: 'passwort123' })).error)
  })
  await check('Admin löscht Benutzer, mit Daten nur deaktiviert, nicht sich selbst', async () => {
    const empty = await user('loeschbar', 'monteur')
    let r = await lead.c.functions.invoke('admin-users', { body: { action: 'delete', user_id: empty.id } })
    assert.equal(r.error.context.status, 403)
    r = await qm.c.functions.invoke('admin-users', { body: { action: 'delete', user_id: empty.id } })
    assert.ifError(r.error)
    assert.equal(r.data.deleted, true)
    const { data: gone } = await admin.from('profiles').select('id').eq('id', empty.id)
    assert.equal(gone.length, 0)
    r = await qm.c.functions.invoke('admin-users', { body: { action: 'delete', user_id: worker.id } })
    assert.ifError(r.error)
    assert.equal(r.data.deactivated, true)
    const { data: w } = await admin.from('profiles').select('active').eq('id', worker.id).single()
    assert.equal(w.active, false)
    await admin.from('profiles').update({ active: true }).eq('id', worker.id)
    r = await qm.c.functions.invoke('admin-users', { body: { action: 'delete', user_id: qm.id } })
    assert.match((await r.error.context.json()).error, /selbst/)
  })
}

await check('Fahrstrecke: nur über den Service-Schlüssel, Adressänderung löscht den Wert', async () => {
  const { data: b } = await qm.c.from('tickets').insert({ ticket_type: 'beanstandung', title: 'km', site_address: 'Hauptstr. 1\n54550 Daun', distance_km: 5 }).select().single()
  assert.equal(b.distance_km, null)
  let r = await qm.c.from('tickets').update({ distance_km: 9, distance_address: 'x' }).eq('id', b.id).select().single()
  assert.equal(r.data.distance_km, null)
  await admin.from('tickets').update({ distance_km: 84.2, distance_address: b.site_address }).eq('id', b.id)
  r = await qm.c.from('tickets').update({ title: 'km2' }).eq('id', b.id).select().single()
  assert.equal(Number(r.data.distance_km), 84.2)
  r = await qm.c.from('tickets').update({ site_address: 'Markt 1\n54568 Gerolstein' }).eq('id', b.id).select().single()
  assert.equal(r.data.distance_km, null)
  assert.equal(r.data.distance_address, '')
})

await check('Vorgesetzter: nur Admin setzt ihn, keine Kreise, Vorgesetzter sieht Zeiten', async () => {
  let r = await worker.c.from('profiles').update({ supervisor_id: lead.id }).eq('id', worker.id)
  assert.match(r.error?.message ?? '', /Nur Admins/)
  r = await qm.c.from('profiles').update({ supervisor_id: lead.id }).eq('id', worker.id)
  assert.ifError(r.error)
  r = await qm.c.from('profiles').update({ supervisor_id: worker.id }).eq('id', lead.id)
  assert.match(r.error?.message ?? '', /Kreis/)
  r = await qm.c.from('profiles').update({ supervisor_id: other.id }).eq('id', other.id)
  assert.ok(r.error)
  // other ist Vorgesetzter von m4 und sieht dessen Stempelzeiten, worker nicht
  await qm.c.from('profiles').update({ supervisor_id: other.id }).eq('id', m4.id)
  await admin.from('attendance').insert({ installer_id: m4.id, started_at: '2026-10-01T06:00:00Z', ended_at: '2026-10-01T14:00:00Z' })
  const seen = await other.c.from('attendance').select('id').eq('installer_id', m4.id)
  assert.ok(seen.data.length >= 1)
  const hidden = await worker.c.from('attendance').select('id').eq('installer_id', m4.id)
  assert.equal(hidden.data.length, 0)
  const { data: up } = await other.c.rpc('is_supervisor_of', { p_user: m4.id })
  assert.equal(up, true)
  await qm.c.from('profiles').update({ supervisor_id: null }).in('id', [worker.id, m4.id])
})

await check('Abweichende Rechnungsadresse: Pflichtfelder, ohne Haken leer, Monteur darf nicht ändern', async () => {
  let r = await qm.c.from('tickets').insert({ ticket_type: 'reparatur', title: 'RA', billing_address_different: true, billing_name: 'Firma X' }).select().single()
  assert.match(r.error?.message ?? '', /Rechnungsadresse/)
  r = await qm.c.from('tickets').insert({ ticket_type: 'reparatur', title: 'RA', billing_address_different: false, billing_name: 'Firma X' }).select().single()
  assert.equal(r.data.billing_name, '')
  const id = r.data.id
  r = await qm.c.from('tickets').update({ billing_address_different: true, billing_name: ' Firma X ', billing_street: 'Weg', billing_house_no: '3a', billing_zip: '54550', billing_city: 'Daun' }).eq('id', id).select().single()
  assert.ifError(r.error)
  assert.equal(r.data.billing_name, 'Firma X')
  await admin.from('tickets').update({ team_id: T1, montage_date: '2026-11-02' }).eq('id', id)
  const m = await m1.c.from('tickets').update({ billing_city: 'Trier' }).eq('id', id).select()
  assert.ok(m.error || m.data.length === 0)
  const m2r = await m1.c.from('tickets').update({ customer_number: '999' }).eq('id', id).select()
  assert.ok(m2r.error || m2r.data.length === 0)
  r = await qm.c.from('tickets').update({ customer_number: ' K-100 ' }).eq('id', id).select().single()
  assert.equal(r.data.customer_number, 'K-100')
  r = await qm.c.from('tickets').update({ billing_address_different: false }).eq('id', id).select().single()
  assert.equal(r.data.billing_city, '')
  await admin.from('tickets').delete().eq('id', id)
})

await check('Abweichende Baustellenadresse: Pflichtfelder, Fahrstrecke wird bei Änderung gelöscht', async () => {
  let r = await qm.c.from('tickets').insert({ ticket_type: 'beanstandung', title: 'BS', jobsite_address_different: true, jobsite_street: 'Weg' }).select().single()
  assert.match(r.error?.message ?? '', /Baustellenadresse/)
  r = await qm.c.from('tickets').insert({ ticket_type: 'beanstandung', title: 'BS', site_address: 'Hauptstr. 1\n54550 Daun' }).select().single()
  const id = r.data.id
  await admin.from('tickets').update({ distance_km: 10, distance_address: 'Hauptstr. 1\n54550 Daun' }).eq('id', id)
  r = await qm.c.from('tickets').update({ jobsite_address_different: true, jobsite_street: 'Baustraße', jobsite_house_no: '1', jobsite_zip: '54568', jobsite_city: 'Gerolstein' }).eq('id', id).select().single()
  assert.ifError(r.error)
  assert.equal(r.data.distance_km, null)
  await admin.from('tickets').update({ team_id: T1, montage_date: '2026-11-02' }).eq('id', id)
  const m = await m1.c.from('tickets').update({ jobsite_city: 'Trier' }).eq('id', id).select()
  assert.ok(m.error || m.data.length === 0)
  r = await qm.c.from('tickets').update({ jobsite_address_different: false }).eq('id', id).select().single()
  assert.equal(r.data.jobsite_street, '')
  await admin.from('tickets').delete().eq('id', id)
})

await check('Kundenadresse in Feldern ergibt site_address, Freitext ohne Felder bleibt', async () => {
  let r = await qm.c.from('tickets').insert({ ticket_type: 'reparatur', title: 'KA', customer_street: ' Bahnhofstr. ', customer_house_no: '5a', customer_zip: '54550', customer_city: 'Daun' }).select().single()
  assert.ifError(r.error)
  assert.equal(r.data.site_address, 'Bahnhofstr. 5a\n54550 Daun')
  const id = r.data.id
  r = await qm.c.from('tickets').update({ customer_house_no: '', customer_zip: '' }).eq('id', id).select().single()
  assert.equal(r.data.site_address, 'Bahnhofstr.\nDaun')
  r = await qm.c.from('tickets').insert({ ticket_type: 'reparatur', title: 'KA2', site_address: 'Alt 1\n12345 Ort' }).select().single()
  assert.equal(r.data.site_address, 'Alt 1\n12345 Ort')
  await admin.from('tickets').delete().in('id', [id, r.data.id])
})

await check('Urlaub: Antrag, Feiertage, nur Vorgesetzter/Admin genehmigt, Anspruch nur Admin', async () => {
  let r = await worker.c.from('profiles').update({ vacation_days: 40 }).eq('id', worker.id)
  assert.match(r.error?.message ?? '', /Urlaubsanspruch/)
  assert.ifError((await qm.c.from('profiles').update({ vacation_days: 30, supervisor_id: other.id }).eq('id', worker.id)).error)
  // 25.05.–05.06.2026: 10 Werktage, davon Pfingstmontag und Fronleichnam frei
  const { data: id, error } = await worker.c.rpc('request_vacation', { p_start: '2026-05-25', p_end: '2026-06-05', p_note: 'Familie' })
  assert.ifError(error)
  const { data: req } = await worker.c.from('vacation_requests').select('*').eq('id', id).single()
  assert.equal(req.days, 8)
  r = await worker.c.rpc('request_vacation', { p_start: '2026-06-01', p_end: '2026-06-02' })
  assert.match(r.error?.message ?? '', /schon/)
  r = await worker.c.rpc('decide_vacation', { p_id: id, p_approve: true })
  assert.match(r.error?.message ?? '', /Vorgesetzte/)
  r = await lead2.c.rpc('decide_vacation', { p_id: id, p_approve: true })
  assert.match(r.error?.message ?? '', /Vorgesetzte/)
  const seen = await lead2.c.from('vacation_requests').select('id').eq('id', id)
  assert.equal(seen.data.length, 1)
  const hidden = await m3.c.from('vacation_requests').select('id').eq('id', id)
  assert.equal(hidden.data.length, 0)
  r = await other.c.rpc('decide_vacation', { p_id: id, p_approve: true, p_note: 'ok' })
  assert.ifError(r.error)
  r = await worker.c.rpc('cancel_vacation', { p_id: id })
  assert.match(r.error?.message ?? '', /nicht zurückziehen/)
  r = await qm.c.rpc('cancel_vacation', { p_id: id })
  assert.ifError(r.error)
  const { data: after } = await admin.from('vacation_requests').select('state, decided_by').eq('id', id).single()
  assert.equal(after.state, 'storniert')
  await admin.from('vacation_requests').delete().eq('user_id', worker.id)
  await qm.c.from('profiles').update({ supervisor_id: null }).eq('id', worker.id)
})

await check('Disposition plant Einsätze wie Teamleiter, meldet aber nicht erledigt', async () => {
  const dispo = await user('dispo', 'disposition')
  let r = await dispo.c.from('team_members').insert({ team_id: T1, day: '2026-11-20', installer_id: m1.id })
  assert.ifError(r.error)
  const { data, error } = await dispo.c.from('tickets').insert({
    ticket_type: 'beanstandung', title: 'Dispo-Test', customer_name: 'Dispo', team_id: T1, montage_date: '2026-11-20',
  }).select().single()
  assert.ifError(error)
  assert.equal(data.status, 'zugewiesen')
  r = await dispo.c.from('tickets').update({ montage_time: '10:00' }).eq('id', data.id).select().single()
  assert.ifError(r.error)
  r = await dispo.c.from('tickets').update({ work_report: 'x', status: 'abgeschlossen' }).eq('id', data.id)
  assert.match(r.error?.message ?? '', /nicht als erledigt/)
  const seen = await dispo.c.from('attendance').select('id').limit(1)
  assert.ifError(seen.error)
  await admin.from('tickets').delete().eq('id', data.id)
  await admin.from('team_members').delete().match({ team_id: T1, day: '2026-11-20' })
})

await check('Folgeauftrag: übernimmt Kunde und offene Positionen, Kette sichtbar', async () => {
  const dispo = await user('dispo2', 'disposition')
  const { data: src } = await dispo.c.from('tickets').insert({
    ticket_type: 'restarbeit', title: 'Fenster', customer_number: 'K-1', customer_name: 'Kette',
    customer_street: 'Weg', customer_house_no: '1', customer_zip: '54570', customer_city: 'Ort',
  }).select().single()
  await admin.from('ticket_positions').insert([
    { ticket_id: src.id, sort: 0, position_number: '1', description: 'A' },
    { ticket_id: src.id, sort: 1, position_number: '2', description: 'B' },
    { ticket_id: src.id, sort: 2, position_number: '3', description: 'C' },
  ])
  const { data: pos } = await admin.from('ticket_positions').select('id, sort').eq('ticket_id', src.id).order('sort')
  await admin.from('ticket_positions').update({ state: 'erledigt' }).eq('id', pos[0].id)
  await admin.from('ticket_positions').update({ state: 'nicht_erledigt', reason: 'Teil fehlt' }).eq('id', pos[1].id)
  await admin.from('ticket_positions').update({ state: 'nicht_erledigt', reason: 'Kunde nicht da' }).eq('id', pos[2].id)

  let r = await m1.c.rpc('create_followup', { p_ticket_id: src.id })
  assert.match(r.error?.message ?? '', /Disposition/)
  r = await dispo.c.rpc('create_followup', { p_ticket_id: src.id })
  assert.ifError(r.error)
  const childId = r.data
  const { data: child } = await admin.from('tickets').select('*').eq('id', childId).single()
  assert.equal(child.parent_id, src.id)
  assert.equal(child.status, 'neu')
  assert.equal(child.customer_number, 'K-1')
  assert.equal(child.site_address, src.site_address)
  const { data: cpos } = await admin.from('ticket_positions').select('description, state').eq('ticket_id', childId).order('sort')
  assert.deepEqual(cpos.map((p) => p.description + p.state), ['Boffen', 'Coffen'])

  r = await dispo.c.rpc('create_followup', { p_ticket_id: childId })
  const grandId = r.data
  r = await dispo.c.from('tickets').update({ parent_id: null }).eq('id', childId)
  assert.equal((await admin.from('tickets').select('parent_id').eq('id', childId).single()).data.parent_id, src.id)
  r = await dispo.c.from('tickets').insert({ ticket_type: 'restarbeit', title: 'x', parent_id: src.id }).select().single()
  assert.equal(r.data.parent_id, null)
  await admin.from('tickets').delete().eq('id', r.data.id)

  const chain = await dispo.c.rpc('ticket_chain', { p_ticket_id: grandId })
  assert.ifError(chain.error)
  assert.deepEqual(chain.data.map((x) => [x.id, x.depth]), [[src.id, 0], [childId, 1], [grandId, 2]])
  assert.equal(chain.data[0].not_done, 2)
  const hidden = await m4.c.rpc('ticket_chain', { p_ticket_id: grandId })
  assert.equal(hidden.data.length, 0)
  await admin.from('tickets').delete().in('id', [grandId, childId, src.id])
})

await check('Überstunden: Soll aus Wochenstunden, Ist aus Stempeluhr ohne feste Pausen, nur Admin pflegt', async () => {
  let r = await worker.c.from('profiles').update({ weekly_hours: 20 }).eq('id', worker.id)
  assert.match(r.error?.message ?? '', /nur der Admin/)
  r = await qm.c.from('profiles').update({ weekly_hours: 40, overtime_start: '2026-11-02', overtime_opening: 2.5 }).eq('id', worker.id)
  assert.ifError(r.error)
  await admin.from('attendance').insert({ installer_id: worker.id, started_at: '2026-11-02T07:00:00+01:00', ended_at: '2026-11-02T17:00:00+01:00' })
  const { data, error } = await worker.c.rpc('overtime_balance', { p_user: worker.id, p_until: '2026-11-06' })
  assert.ifError(error)
  assert.deepEqual(data[0], { since: '2026-11-02', until: '2026-11-06', target_min: 2400, actual_min: 555, opening_min: 150, balance_min: -1695, planned_min: 0, requested_min: 0 })
  r = await other.c.rpc('overtime_balance', { p_user: worker.id })
  assert.match(r.error?.message ?? '', /Berechtigung/)
  // Freizeit über Überstunden: bleibt Soll (mindert den Saldo), künftige Tage werden als verplant gezeigt
  await qm.c.from('profiles').update({ supervisor_id: other.id }).eq('id', worker.id)
  r = await worker.c.rpc('request_vacation', { p_start: '2026-11-05', p_end: '2026-11-05', p_kind: 'ueberstunden' })
  assert.ifError(r.error)
  await other.c.rpc('decide_vacation', { p_id: r.data, p_approve: true })
  r = await worker.c.rpc('request_vacation', { p_start: '2026-11-04', p_end: '2026-11-04', p_kind: 'urlaub' })
  await other.c.rpc('decide_vacation', { p_id: r.data, p_approve: true })
  r = await worker.c.rpc('request_vacation', { p_start: '2026-11-09', p_end: '2026-11-10', p_kind: 'ueberstunden' })
  let b = (await worker.c.rpc('overtime_balance', { p_user: worker.id, p_until: '2026-11-06' })).data[0]
  assert.equal(b.target_min, 1920, 'nur der Urlaubstag zählt nicht als Soll')
  assert.equal(b.planned_min, 0)
  assert.equal(b.requested_min, 960)
  b = (await worker.c.rpc('overtime_balance', { p_user: worker.id, p_until: '2026-11-03' })).data[0]
  assert.equal(b.planned_min, 480)
  await admin.from('vacation_requests').delete().eq('user_id', worker.id)
  await qm.c.from('profiles').update({ supervisor_id: null }).eq('id', worker.id)
  await admin.from('attendance').delete().eq('installer_id', worker.id).gte('started_at', '2026-11-02').lt('started_at', '2026-11-03')
})

await check('Selbstkosten: km × 0,90 + Arbeitszeit × 55 + Positionen, nur abgeschlossene Beanstandung, nur Planer', async () => {
  const { data: t } = await admin.from('tickets').insert({ ticket_type: 'beanstandung', title: 'Kosten', created_by: qm.id }).select().single()
  const { data: art } = await admin.from('articles').insert({ article_number: `K-${run}`, description: 'Kostenartikel', unit: 'Stk', price: 10 }).select().single()
  await admin.from('ticket_positions').insert([
    { ticket_id: t.id, sort: 0, position_number: '1', description: 'A', article_id: art.id },
    { ticket_id: t.id, sort: 1, position_number: '2', description: 'B' },
  ])
  let r = await qm.c.rpc('calc_self_cost', { p_ticket_id: t.id })
  assert.match(r.error?.message ?? '', /nicht abgeschlossen/)
  await admin.from('ticket_positions').update({ state: 'erledigt' }).eq('ticket_id', t.id)
  await admin.from('tickets').update({ work_report: 'ok', status: 'abgeschlossen', distance_km: 100 }).eq('id', t.id)
  await admin.from('time_entries').insert([
    { ticket_id: t.id, installer_id: m1.id, kind: 'arbeit', started_at: '2026-11-02T07:00:00Z', ended_at: '2026-11-02T09:00:00Z' },
    { ticket_id: t.id, installer_id: m2.id, kind: 'arbeit', started_at: '2026-11-02T07:00:00Z', ended_at: '2026-11-02T08:30:00Z' },
  ])
  r = await m1.c.rpc('calc_self_cost', { p_ticket_id: t.id })
  assert.match(r.error?.message ?? '', /nur Admin/)
  r = await lead.c.rpc('calc_self_cost', { p_ticket_id: t.id })
  assert.ifError(r.error)
  assert.equal(Number(r.data.km_cost), 90)
  assert.equal(r.data.work_minutes, 210)
  assert.equal(Number(r.data.work_cost), 192.5)
  assert.equal(Number(r.data.positions_cost), 10)
  assert.equal(r.data.positions_without_price, 1)
  assert.equal(Number(r.data.total), 292.5)
  assert.equal((await m1.c.from('ticket_costs').select('*').eq('ticket_id', t.id)).data.length, 0)
  await admin.from('tickets').delete().eq('id', t.id)
  await admin.from('articles').delete().eq('id', art.id)
})

await check('Kunden & CRM: Nummer automatisch, Monteur ohne Zugriff, Verlauf unveränderlich, Wiedervorlage abhaken', async () => {
  const { data: c, error } = await worker.c.from('customers').insert({ name: ' Eifel Bau GmbH ', customer_group: 'bautraeger' }).select().single()
  assert.ifError(error)
  assert.match(c.customer_number, /^K-\d+$/)
  assert.equal(c.name, 'Eifel Bau GmbH')
  assert.equal((await m1.c.from('customers').select('id').eq('id', c.id)).data.length, 0)
  assert.ok((await m1.c.from('customers').insert({ name: 'x' })).error)
  const bad = await lead.c.from('customers').insert({ name: 'y', customer_group: 'sonstwas' })
  assert.ok(bad.error)
  const dup = await lead.c.from('customers').insert({ name: 'z', customer_number: c.customer_number })
  assert.match(dup.error?.message ?? '', /customers_number_unique/)
  const { data: p } = await lead.c.from('customer_contacts').insert({ customer_id: c.id, name: 'Herr Klein', position: 'Bauleiter' }).select().single()
  const { data: n, error: nErr } = await lead.c
    .from('customer_notes')
    .insert({ customer_id: c.id, contact_id: p.id, kind: 'telefon', subject: 'Angebot', body: 'Rückruf', follow_up_date: '2026-11-05', created_by: qm.id })
    .select()
    .single()
  assert.ifError(nErr)
  assert.equal(n.created_by, lead.id)
  assert.equal(n.follow_up_user, lead.id)
  const change = await worker.c.from('customer_notes').update({ body: 'anders' }).eq('id', n.id)
  assert.match(change.error?.message ?? '', /nicht geändert/)
  const { data: done } = await worker.c.from('customer_notes').update({ follow_up_done_at: '2000-01-01T00:00:00Z' }).eq('id', n.id).select().single()
  assert.equal(done.follow_up_done_by, worker.id)
  assert.ok(done.follow_up_done_at > '2026')
  const del = await lead.c.from('customer_notes').delete().eq('id', n.id).select()
  assert.equal(del.data.length, 0)
  // Auftrag verknüpfen, Monteur kann die Verknüpfung nicht ändern, Folgeauftrag übernimmt sie
  const { data: t } = await lead.c.from('tickets').insert({ ticket_type: 'reparatur', title: 'CRM', customer_id: c.id, team_id: T1, montage_date: '2026-11-03' }).select().single()
  const mt = await m1.c.from('tickets').update({ customer_id: null }).eq('id', t.id)
  assert.ok(mt.error)
  const f = await lead.c.rpc('create_followup', { p_ticket_id: t.id })
  assert.ifError(f.error)
  const { data: ft } = await admin.from('tickets').select('customer_id').eq('id', f.data).single()
  assert.equal(ft.customer_id, c.id)
  await admin.from('tickets').delete().in('id', [f.data, t.id])
  assert.equal((await lead.c.from('customers').delete().eq('id', c.id).select()).data.length, 0)
  assert.ifError((await qm.c.from('customers').delete().eq('id', c.id)).error)
})

await check('Bauvorhaben: Pflicht, automatisch aus Adresse, Wiederverwendung, Kunde beteiligt, Folgeauftrag erbt', async () => {
  const { data: c } = await lead.c.from('customers').insert({ name: 'BV Kunde', street: 'Ringstr.', house_no: '1', zip: '54550', city: 'Daun' }).select().single()
  const base = { ticket_type: 'reparatur', customer_id: c.id, customer_name: 'BV Kunde', customer_street: 'Ringstr.', customer_house_no: '1', customer_zip: '54550', customer_city: 'Daun' }
  const { data: t1, error } = await lead.c.from('tickets').insert({ ...base, title: 'A', team_id: T1, montage_date: '2026-11-03' }).select().single()
  assert.ifError(error)
  assert.ok(t1.project_id)
  const { data: p } = await lead.c.from('projects').select('*, project_customers(customer_id, role)').eq('id', t1.project_id).single()
  assert.equal(p.name, 'BV Kunde, Daun')
  assert.match(p.project_number, /^BV-\d+$/)
  assert.deepEqual(p.project_customers.map((x) => [x.customer_id, x.role]), [[c.id, 'bauherr']])
  const { data: t2 } = await worker.c.from('tickets').insert({ ...base, title: 'B' }).select().single()
  assert.equal(t2.project_id, t1.project_id)
  const nul = await lead.c.from('tickets').update({ project_id: null }).eq('id', t1.id)
  assert.match(nul.error?.message ?? '', /Bauvorhaben/)
  const mt = await m1.c.from('tickets').update({ project_id: t1.project_id }).eq('id', t1.id).select()
  assert.ifError(mt.error)
  assert.equal((await m1.c.from('projects').select('id').eq('id', t1.project_id)).data.length, 0)
  const f = await lead.c.rpc('create_followup', { p_ticket_id: t1.id })
  const { data: ft } = await admin.from('tickets').select('project_id').eq('id', f.data).single()
  assert.equal(ft.project_id, t1.project_id)
  const { data: gu } = await lead.c.from('customers').insert({ name: 'GU', customer_group: 'generalunternehmer' }).select().single()
  const pc = await worker.c.from('project_customers').insert({ project_id: t1.project_id, customer_id: gu.id, role: 'generalunternehmer' })
  assert.ifError(pc.error)
  const del = await lead.c.from('projects').delete().eq('id', t1.project_id).select()
  assert.equal(del.data.length, 0)
  await admin.from('tickets').delete().in('id', [f.data, t2.id, t1.id])
  await admin.from('projects').delete().eq('id', t1.project_id)
  await admin.from('customers').delete().in('id', [c.id, gu.id])
})

await check('Offline: Stempeln mit Uhrzeit vom Handy, nicht in der Zukunft, höchstens 7 Tage alt', async () => {
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString()
  assert.ifError((await worker.c.rpc('clock_out')).error)
  await admin.from('attendance').delete().eq('installer_id', worker.id)
  const old = await worker.c.rpc('clock_in', { p_at: ago(8 * 24 * 60) })
  assert.match(old.error?.message ?? '', /älter als 7 Tage/)
  const { data: id } = await worker.c.rpc('clock_in', { p_at: ago(120) })
  assert.ifError((await worker.c.rpc('clock_out', { p_at: ago(30) })).error)
  const { data: a } = await admin.from('attendance').select('started_at, ended_at').eq('id', id).single()
  assert.ok(Math.abs(new Date(a.started_at) - new Date(ago(120))) < 5000)
  assert.ok(Math.abs(new Date(a.ended_at) - new Date(ago(30))) < 5000)
  const { data: id2 } = await worker.c.rpc('clock_in', { p_at: new Date(Date.now() + 3600000).toISOString() })
  const { data: b } = await admin.from('attendance').select('started_at').eq('id', id2).single()
  assert.ok(new Date(b.started_at) <= new Date(Date.now() + 5000), 'Zukunft wird auf jetzt gesetzt')
  assert.ifError((await worker.c.rpc('clock_out')).error)
  // nachträglich übertragenes Kommen überschneidet sich nicht mit späteren Zeiten
  const { data: id3 } = await worker.c.rpc('clock_in', { p_at: ago(60) })
  const { data: c } = await admin.from('attendance').select('started_at').eq('id', id3).single()
  assert.ok(new Date(c.started_at) >= new Date(b.started_at))
  assert.ifError((await worker.c.rpc('clock_out')).error)
  await admin.from('attendance').delete().in('id', [id, id2, id3])
})

// Testteams wieder entfernen, damit sie nicht im Kalender auftauchen
await admin.from('tickets').update({ team_id: null }).in('team_id', [T1, T2])
await admin.from('teams').delete().in('id', [T1, T2])

console.log(`\n${passed} Prüfungen bestanden`)
