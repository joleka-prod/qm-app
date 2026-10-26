// Einmaliger Mitarbeiter-Import aus Ninox (Fabian, 2026-10-26): liest Arbeitsbereiche, Datenbanken,
// Tabellen und Datensätze über die Ninox-REST-API. Nur lesend; angelegt werden die Benutzer danach in der
// App über admin-users. Der API-Schlüssel liegt als Secret NINOX_API_KEY in Supabase und verlässt den
// Server nicht. Aufrufer muss aktiver Admin sein. NINOX_API_URL nur für Tests / Private Cloud.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const base = (Deno.env.get('NINOX_API_URL') ?? 'https://api.ninox.com/v1').replace(/\/$/, '')
const seg = (s: unknown) => encodeURIComponent(String(s ?? ''))

async function ninox(path: string) {
  const res = await fetch(base + path, { headers: { Authorization: `Bearer ${Deno.env.get('NINOX_API_KEY')}` } })
  if (res.status === 401 || res.status === 403) throw new Error('Ninox lehnt den API-Schlüssel ab. Bitte NINOX_API_KEY in Supabase prüfen.')
  if (!res.ok) throw new Error(`Ninox antwortet mit Fehler ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

// Ninox liefert Listen als Array von { id, name, … }
const named = (list: unknown) =>
  (Array.isArray(list) ? list : []).map((x: { id: unknown; name?: unknown; caption?: unknown }) => ({
    id: String(x.id),
    name: String(x.name ?? x.caption ?? x.id),
  }))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'Nur POST erlaubt' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
  const { data: caller } = await admin.auth.getUser(token)
  if (!caller.user) return reply(401, { error: 'Nicht angemeldet' })
  const { data: me } = await admin.from('profiles').select('role, active').eq('id', caller.user.id).single()
  if (!me || me.role !== 'admin' || !me.active) return reply(403, { error: 'Nur für Admins' })

  if (!Deno.env.get('NINOX_API_KEY')) {
    return reply(400, { error: 'In Supabase fehlt das Secret NINOX_API_KEY (Edge Functions → Secrets).' })
  }

  let body: { action?: string; team?: string; database?: string; table?: string }
  try {
    body = await req.json()
  } catch {
    return reply(400, { error: 'Ungültige Anfrage' })
  }

  try {
    if (body.action === 'teams') return reply(200, named(await ninox('/teams')))
    if (body.action === 'databases') return reply(200, named(await ninox(`/teams/${seg(body.team)}/databases`)))
    if (body.action === 'tables') {
      return reply(200, named(await ninox(`/teams/${seg(body.team)}/databases/${seg(body.database)}/tables`)))
    }
    if (body.action === 'records') {
      const path = `/teams/${seg(body.team)}/databases/${seg(body.database)}/tables/${seg(body.table)}/records`
      const perPage = 500
      const rows: { id: string; fields: Record<string, unknown> }[] = []
      for (let page = 0; page < 40; page++) {
        const list = await ninox(`${path}?page=${page}&perPage=${perPage}`)
        if (!Array.isArray(list) || list.length === 0) break
        for (const r of list) {
          const { id, fields, ...rest } = r as { id: unknown; fields?: Record<string, unknown> }
          rows.push({ id: String(id), fields: fields ?? rest })
        }
        if (list.length < perPage) break
      }
      return reply(200, rows)
    }
  } catch (err) {
    return reply(502, { error: (err as Error).message })
  }
  return reply(400, { error: 'Unbekannte Aktion' })
})
