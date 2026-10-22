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
  const { data, error } = await worker.c.from('tickets').insert({ title: 'Kratzer', description: 'am Gehäuse', status: 'abgeschlossen', cause: 'x' }).select().single()
  assert.ifError(error)
  assert.equal(data.status, 'neu')
  assert.equal(data.cause, '')
  assert.equal(data.created_by, worker.id)
  ticketId = data.id
})

await check('Mitarbeiter kann Rolle nicht selbst ändern', async () => {
  const { error } = await worker.c.from('profiles').update({ role: 'admin' }).eq('id', worker.id)
  assert.ok(error)
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
  for (const k of ['erstellt', 'zugewiesen', 'ursache', 'massnahme', 'status', 'pruefhinweis']) assert.ok(kinds.includes(k), k)
})

console.log(`\n${passed} Prüfungen bestanden`)
