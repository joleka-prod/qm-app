// Kundenabgleich aus 3E Look (Fabian, 2026-10-28): Das Sync-Programm auf dem 3E-Server (tools/3e-sync) schickt die Kunden
// per POST { customers: [...], dry_run: true|false } hierher; geschrieben wird über die RPC import_3e_customers.
// Secret: SYNC_3E_KEY (langes Zufallspasswort, gleich wie in der Einstellungsdatei des Sync-Programms), Header x-sync-key.
import { createClient } from 'npm:@supabase/supabase-js@2'

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// Vergleich ohne frühen Abbruch, damit der Schlüssel nicht über die Antwortzeit erraten werden kann
function sameKey(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'Nur POST' })
  const key = Deno.env.get('SYNC_3E_KEY') ?? ''
  if (key.length < 20) return reply(500, { error: 'SYNC_3E_KEY ist nicht (oder zu kurz) gesetzt.' })
  if (!sameKey(req.headers.get('x-sync-key') ?? '', key)) return reply(401, { error: 'Falscher Sync-Schlüssel' })

  const body = await req.json().catch(() => null)
  const rows = body?.customers
  if (!Array.isArray(rows)) return reply(400, { error: 'customers fehlt' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data, error } = await admin.rpc('import_3e_customers', { p_rows: rows, p_dry_run: body.dry_run !== false })
  if (error) return reply(500, { error: error.message })
  return reply(200, data)
})
