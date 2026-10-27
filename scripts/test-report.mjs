// Prüft die Edge Function send-report gegen eine lokale Supabase-Instanz und einen Test-Mailserver.
// Aufruf: FUNCTION_URL=http://127.0.0.1:8000 SUPABASE_ANON_KEY=... SUPABASE_SERVICE_KEY=... node scripts/test-report.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const fnUrl = process.env.FUNCTION_URL ?? 'http://127.0.0.1:8000'
const admin = createClient(url, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
const run = Date.now()
let passed = 0

async function user(name, role) {
  const email = `${name}-${run}@test.local`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'passwort123', email_confirm: true })
  if (error) throw error
  await admin.from('profiles').update({ role, full_name: name }).eq('id', data.user.id)
  const c = createClient(url, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: s } = await c.auth.signInWithPassword({ email, password: 'passwort123' })
  return { id: data.user.id, c, token: s.session.access_token }
}
async function check(label, fn) {
  await fn()
  passed++
  console.log(`ok - ${label}`)
}
async function send(u, ticket_id, force = false) {
  const r = await fetch(fnUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket_id, force }),
  })
  return { status: r.status, body: await r.json() }
}

const qm = await user('qm', 'admin')
const lead = await user('lead', 'teamleiter')
const m1 = await user('monteur1', 'monteur')
const m2 = await user('monteur2', 'monteur')
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex')
const jpg = process.env.TEST_JPG ? readFileSync(process.env.TEST_JPG) : null

const { data: team } = await admin.from('teams').insert({ name: `Report ${run}`, area: 'kundendienst', sort: 950 }).select().single()
await admin.from('team_members').insert([
  { team_id: team.id, day: '2026-11-02', installer_id: m1.id },
  { team_id: team.id, day: '2026-11-03', installer_id: m2.id },
])
const { data: job } = await qm.c.from('tickets').insert({
  ticket_type: 'reparatur', title: 'Fenster undicht', customer_name: 'Familie Müller', customer_email: 'kunde@example.test',
  site_address: 'Hauptstr. 1\n88400 Biberach', team_id: team.id, montage_date: '2026-11-02', order_number: 'A-4711',
}).select().single()
const { data: pos } = await qm.c.from('ticket_positions').insert([
  { ticket_id: job.id, sort: 0, position_number: '10', description: 'Dichtung tauschen' },
  { ticket_id: job.id, sort: 1, position_number: '20', description: 'Griff ersetzen' },
]).select().order('sort')

await check('Versand erst nach Erledigt', async () => {
  const r = await send(m1, job.id)
  assert.equal(r.status, 400)
})

await check('Monteur erledigt Auftrag mit Unterschrift und E-Mail-Wunsch', async () => {
  if (jpg) {
    await m1.c.storage.from('ticket-photos').upload(`${job.id}/p.jpg`, jpg, { contentType: 'image/jpeg' })
    await m1.c.from('ticket_photos').insert({ ticket_id: job.id, position_id: pos[0].id, storage_path: `${job.id}/p.jpg` })
    await m1.c.storage.from('ticket-photos').upload(`${job.id}/a.jpg`, jpg, { contentType: 'image/jpeg' })
    await m1.c.from('ticket_photos').insert({ ticket_id: job.id, storage_path: `${job.id}/a.jpg` })
  }
  await m1.c.storage.from('ticket-photos').upload(`${job.id}/unterschrift-x.png`, png, { contentType: 'image/png' })
  let r = await m1.c.from('tickets').update({ signature_path: `${job.id}/unterschrift-x.png`, signer_name: 'Petra Müller', report_by_email: true, report_sent_at: new Date().toISOString() }).eq('id', job.id).select().single()
  assert.ifError(r.error)
  assert.equal(r.data.report_sent_at, null)
  await m1.c.from('ticket_positions').update({ state: 'erledigt' }).eq('id', pos[0].id)
  await m1.c.from('ticket_positions').update({ state: 'nicht_erledigt', reason: 'Griff nicht lieferbar' }).eq('id', pos[1].id)
  await admin.from('time_entries').insert([
    { ticket_id: job.id, installer_id: m1.id, kind: 'arbeit', started_at: '2026-11-02T07:30:00Z', ended_at: '2026-11-02T09:15:00Z' },
    { ticket_id: job.id, installer_id: m1.id, kind: 'arbeit', started_at: '2026-11-02T09:45:00Z', ended_at: '2026-11-02T11:00:00Z' },
  ])
  r = await m1.c.from('tickets').update({ work_report: 'Dichtung getauscht.\nGriff folgt.', status: 'abgeschlossen' }).eq('id', job.id).select().single()
  assert.ifError(r.error)
})

await check('Fremder Monteur darf nicht senden', async () => {
  const r = await send(m2, job.id)
  assert.equal(r.status, 403)
})

await check('Monteur sendet Bericht, PDF hängt an', async () => {
  const r = await send(m1, job.id)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const mail = JSON.parse(readFileSync(`${process.env.MAIL_DIR}/last-mail.json`, 'utf8'))
  assert.deepEqual(mail.to, ['kunde@example.test'])
  assert.equal(mail.auth, 'Bearer re_test')
  assert.match(mail.subject, /Servicebericht RP-\d{4}/)
  assert.equal(mail.attachments.length, 1)
  assert.ok(mail.attachments[0].size > 1000)
  const { data } = await qm.c.from('tickets').select('report_sent_at, report_pdf_path').eq('id', job.id).single()
  assert.ok(data.report_sent_at)
  // gesendetes PDF ist im Auftrag gespeichert und für Berechtigte abrufbar
  assert.match(data.report_pdf_path, new RegExp(`^${job.id}/servicebericht-.*\\.pdf$`))
  const { data: file, error } = await qm.c.storage.from('ticket-photos').download(data.report_pdf_path)
  assert.ifError(error)
  assert.equal(new TextDecoder().decode((await file.arrayBuffer()).slice(0, 5)), '%PDF-')
})

await check('Kein doppelter Versand, Monteur kann nicht erzwingen, Teamleiter schon', async () => {
  let r = await send(m1, job.id, true)
  assert.equal(r.body.already, true)
  r = await send(lead, job.id, true)
  assert.equal(r.status, 200)
  assert.ok(r.body.sent_at)
})

await check('Fehler beim Versand wird gespeichert', async () => {
  const { data: j2 } = await qm.c.from('tickets').insert({ ticket_type: 'restarbeit', title: 'Fehlertest', customer_email: 'fail@example.test', team_id: team.id, montage_date: '2026-11-02' }).select().single()
  await m1.c.from('tickets').update({ report_by_email: true, work_report: 'x', status: 'abgeschlossen' }).eq('id', j2.id)
  const r = await send(m1, j2.id)
  assert.equal(r.status, 502)
  const { data } = await qm.c.from('tickets').select('report_sent_at, report_send_error').eq('id', j2.id).single()
  assert.equal(data.report_sent_at, null)
  assert.match(data.report_send_error, /422/)
})

await admin.from('tickets').update({ team_id: null }).eq('team_id', team.id)
await admin.from('teams').delete().eq('id', team.id)

console.log(`\n${passed} Prüfungen bestanden`)
