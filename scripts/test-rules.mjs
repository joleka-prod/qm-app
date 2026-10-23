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

let ticketId

await check('Mitarbeiter legt Ticket an, Status neu', async () => {
  const { data, error } = await worker.c.from('tickets').insert({ title: 'Kratzer', description: 'am Gehäuse', order_number: '4711', status: 'abgeschlossen', cause: 'x' }).select().single()
  assert.ifError(error)
  assert.equal(data.order_number, '4711')
  assert.equal(data.status, 'neu')
  assert.equal(data.cause, '')
  assert.equal(data.created_by, worker.id)
  ticketId = data.id
})

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

await check('Anderer Mitarbeiter sieht fremdes Ticket nicht', async () => {
  const { data } = await other.c.from('tickets').select().eq('id', ticketId)
  assert.equal(data.length, 0)
})

await check('Foto hochladen durch Ersteller, fremder Nutzer darf nicht', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex')
  const path = `${ticketId}/a.png`
  const up = await worker.c.storage.from('ticket-photos').upload(path, png, { contentType: 'image/png' })
  assert.ifError(up.error)
  const ins = await worker.c.from('ticket_photos').insert({ ticket_id: ticketId, storage_path: path })
  assert.ifError(ins.error)
  const bad = await other.c.storage.from('ticket-photos').upload(`${ticketId}/b.png`, png, { contentType: 'image/png' })
  assert.ok(bad.error)
  const dl = await other.c.storage.from('ticket-photos').createSignedUrl(path, 60)
  assert.ok(dl.error)
  const ok = await lead.c.storage.from('ticket-photos').createSignedUrl(path, 60)
  assert.ifError(ok.error)
})

await check('Teamleiter kann sich nicht selbst zuweisen', async () => {
  const { error, data } = await lead.c.from('tickets').update({ assigned_to: lead.id }).eq('id', ticketId).select()
  assert.ok(error || data.length === 0)
})

await check('Mitarbeiter kann keinen Mitarbeiter als Verantwortlichen setzen', async () => {
  const { error } = await worker.c.from('tickets').insert({ title: 'x', assigned_to: other.id })
  assert.ok(error)
})

await check('QM weist Teamleiter zu, Status zugewiesen', async () => {
  const { data, error } = await qm.c.from('tickets').update({ assigned_to: lead.id }).eq('id', ticketId).select().single()
  assert.ifError(error)
  assert.equal(data.status, 'zugewiesen')
})

await check('Ersteller kann nach Zuweisung nichts mehr ändern', async () => {
  const { error, data } = await worker.c.from('tickets').update({ title: 'neu' }).eq('id', ticketId).select()
  assert.ok(error || data.length === 0)
})

await check('Anderer Teamleiter kann Ursache nicht eintragen', async () => {
  const { error, data } = await lead2.c.from('tickets').update({ cause: 'x' }).eq('id', ticketId).select()
  assert.ok(error || data.length === 0)
})

await check('Teamleiter ergänzt Auftrags- und Positionsnummer', async () => {
  const { data, error } = await lead.c.from('tickets').update({ order_number: ' A-4711 ', position_number: '3' }).eq('id', ticketId).select().single()
  assert.ifError(error)
  assert.equal(data.order_number, 'A-4711')
  assert.equal(data.position_number, '3')
})

await check('Anderer Teamleiter kann Auftragsnummer nicht ändern', async () => {
  const { error, data } = await lead2.c.from('tickets').update({ order_number: 'X' }).eq('id', ticketId).select()
  assert.ok(error || data.length === 0)
})

await check('Teamleiter darf Titel nicht ändern', async () => {
  const { error } = await lead.c.from('tickets').update({ title: 'anders' }).eq('id', ticketId)
  assert.ok(error)
})

await check('Zur Prüfung nur mit Ursache und Maßnahme', async () => {
  const { error } = await lead.c.from('tickets').update({ cause: 'Werkzeug stumpf', status: 'zur_pruefung' }).eq('id', ticketId)
  assert.ok(error)
})

await check('Teamleiter trägt Ursache ein, Status in Bearbeitung', async () => {
  const { data, error } = await lead.c.from('tickets').update({ cause: 'Werkzeug stumpf' }).eq('id', ticketId).select().single()
  assert.ifError(error)
  assert.equal(data.status, 'in_bearbeitung')
})

await check('Teamleiter kann nicht selbst abschließen', async () => {
  const { error } = await lead.c.from('tickets').update({ corrective_action: 'Wechselintervall', status: 'abgeschlossen' }).eq('id', ticketId)
  assert.ok(error)
})

await check('Teamleiter meldet erledigt', async () => {
  const { data, error } = await lead.c.from('tickets').update({ corrective_action: 'Wechselintervall verkürzt', status: 'zur_pruefung' }).eq('id', ticketId).select().single()
  assert.ifError(error)
  assert.equal(data.status, 'zur_pruefung')
})

await check('QM gibt zurück, dann schließt ab', async () => {
  let r = await qm.c.from('tickets').update({ status: 'in_bearbeitung', review_note: 'Bitte Schulung ergänzen' }).eq('id', ticketId).select().single()
  assert.ifError(r.error)
  r = await lead.c.from('tickets').update({ corrective_action: 'Wechselintervall verkürzt, Schulung', status: 'zur_pruefung' }).eq('id', ticketId).select().single()
  assert.ifError(r.error)
  r = await qm.c.from('tickets').update({ status: 'abgeschlossen' }).eq('id', ticketId).select().single()
  assert.ifError(r.error)
  assert.ok(r.data.closed_at)
})

await check('Abgeschlossenes Ticket ist für Teamleiter gesperrt', async () => {
  const { error } = await lead.c.from('tickets').update({ cause: 'y' }).eq('id', ticketId)
  assert.ok(error)
})

await check('Verlauf ist vollständig und für Ersteller sichtbar', async () => {
  const { data, error } = await worker.c.from('ticket_events').select('kind, details').eq('ticket_id', ticketId).order('id')
  assert.ifError(error)
  const kinds = data.map((e) => e.kind)
  for (const k of ['auftrag', 'erstellt', 'zugewiesen', 'ursache', 'massnahme', 'status', 'pruefhinweis']) assert.ok(kinds.includes(k), k)
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
  const { data: q } = await qm.c.from('tickets').insert({ title: 'QM mit Mail', customer_email: 'a@b.de', report_by_email: true }).select().single()
  assert.equal(q.customer_email, '')
  assert.equal(q.report_by_email, false)
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

await check('QM-Ticket ignoriert Monteur-Felder', async () => {
  const { data, error } = await qm.c.from('tickets').insert({ title: 'QM', team_id: T1, montage_date: '2026-11-02' }).select().single()
  assert.ifError(error)
  assert.equal(data.team_id, null)
  assert.equal(data.montage_date, null)
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

await check('QM-Ticket bekommt keine Positionen', async () => {
  const { data: t } = await qm.c.from('tickets').insert({ title: 'QM ohne Pos' }).select().single()
  const r = await qm.c.from('ticket_positions').insert({ ticket_id: t.id, description: 'x' })
  assert.ok(r.error)
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
}

// Testteams wieder entfernen, damit sie nicht im Kalender auftauchen
await admin.from('tickets').update({ team_id: null }).in('team_id', [T1, T2])
await admin.from('teams').delete().in('id', [T1, T2])

console.log(`\n${passed} Prüfungen bestanden`)
