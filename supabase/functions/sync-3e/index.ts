// Abgleich aus 3E Look (Fabian, 2026-10-28): Das Sync-Programm auf dem 3E-Server (tools/3e-sync) schickt die Kunden
// per POST { customers: [...], dry_run: true|false } bzw. die Projekte als Bauvorhaben per POST { projects: [...], dry_run }
// hierher, die Aufträge per POST { orders: [...], dry_run } und die Angebote per POST { offers: [...], dry_run };
// geschrieben wird über die RPCs import_3e_customers, import_3e_projects bzw. import_3e_documents (Belegart auftrag/angebot).
// Secret: SYNC_3E_KEY (langes Zufallspasswort, gleich wie in der Einstellungsdatei des Sync-Programms), Header x-sync-key.
import { createClient } from 'npm:@supabase/supabase-js@2'

// charset nötig: Windows PowerShell 5.1 liest die Antwort sonst als ISO-8859-1 (Umlaute in Vorschau und Log kaputt)
function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
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
  const dryRun = body?.dry_run !== false
  let call: [string, Record<string, unknown>]
  if (Array.isArray(body?.orders)) call = ['import_3e_documents', { p_rows: body.orders, p_doc_type: 'auftrag', p_dry_run: dryRun }]
  else if (Array.isArray(body?.offers)) call = ['import_3e_documents', { p_rows: body.offers, p_doc_type: 'angebot', p_dry_run: dryRun }]
  else if (Array.isArray(body?.projects)) call = ['import_3e_projects', { p_rows: body.projects, p_dry_run: dryRun }]
  else if (Array.isArray(body?.customers)) call = ['import_3e_customers', { p_rows: body.customers, p_dry_run: dryRun }]
  else return reply(400, { error: 'customers, projects, orders oder offers fehlt' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data, error } = await admin.rpc(...call)
  if (error) return reply(500, { error: error.message })
  return reply(200, data)
})
