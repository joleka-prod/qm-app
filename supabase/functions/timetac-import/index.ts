// Einmaliger Import aus TimeTac (Fabian, 2026-10-27): liest Benutzer, Aufgaben, Zeitbuchungen, Abwesenheitstage und -anträge über die
// TimeTac-API v4 (OAuth2 client_credentials). Nur lesend; geschrieben wird danach in der App.
// Secrets: TIMETAC_ACCOUNT (Kontoname aus der TimeTac-Adresse), TIMETAC_CLIENT_ID, TIMETAC_CLIENT_SECRET.
// TIMETAC_API_URL nur für Tests. Aufrufer muss aktiver Admin sein.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const base = (Deno.env.get('TIMETAC_API_URL') ?? 'https://api.timetac.com').replace(/\/$/, '')
const account = encodeURIComponent(Deno.env.get('TIMETAC_ACCOUNT') ?? '')

async function token() {
  const res = await fetch(`${base}/${account}/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: Deno.env.get('TIMETAC_CLIENT_ID') ?? '',
      client_secret: Deno.env.get('TIMETAC_CLIENT_SECRET') ?? '',
    }),
  })
  if (!res.ok) throw new Error(`TimeTac lehnt die Anmeldung ab (${res.status}). Bitte TIMETAC_ACCOUNT, TIMETAC_CLIENT_ID und TIMETAC_CLIENT_SECRET prüfen.`)
  const data = await res.json()
  if (!data.access_token) throw new Error('TimeTac hat kein Zugriffs-Token geliefert.')
  return String(data.access_token)
}

// liest alle Seiten einer Ressource (…/read/), Filter als Query-Parameter
async function readAll(tok: string, resources: string[], params: Record<string, string> = {}) {
  let lastErr = ''
  for (const resource of resources) {
    const rows: unknown[] = []
    const limit = 500
    let ok = true
    for (let page = 0; page < 400; page++) {
      const q = new URLSearchParams({ ...params, _limit: String(limit), _offset: String(rows.length) })
      const res = await fetch(`${base}/${account}/v4/${resource}/read/?${q}`, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' } })
      if (res.status === 404) {
        ok = false
        lastErr = `${resource}: nicht gefunden`
        break
      }
      const data = await res.json().catch(() => null)
      if (!res.ok || !data || data.Success === false) {
        throw new Error(`TimeTac (${resource}) antwortet mit Fehler ${res.status}: ${data?.ErrorMessage ?? data?.Error ?? ''}`.trim())
      }
      const list = Array.isArray(data.Results) ? data.Results : []
      rows.push(...list)
      // nicht auf volle Seiten verlassen: TimeTac kann weniger pro Seite liefern als angefragt
      if (list.length === 0) break
    }
    if (ok) return rows
  }
  throw new Error(`TimeTac-Ressource nicht gefunden (${lastErr})`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'Nur POST erlaubt' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
  const { data: caller } = await admin.auth.getUser(jwt)
  if (!caller.user) return reply(401, { error: 'Nicht angemeldet' })
  const { data: me } = await admin.from('profiles').select('role, active').eq('id', caller.user.id).single()
  if (!me || me.role !== 'admin' || !me.active) return reply(403, { error: 'Nur für Admins' })

  if (!account || !Deno.env.get('TIMETAC_CLIENT_ID') || !Deno.env.get('TIMETAC_CLIENT_SECRET')) {
    return reply(400, { error: 'In Supabase fehlen die Secrets TIMETAC_ACCOUNT, TIMETAC_CLIENT_ID und TIMETAC_CLIENT_SECRET (Edge Functions → Secrets).' })
  }

  let body: { action?: string; from?: string; to?: string }
  try {
    body = await req.json()
  } catch {
    return reply(400, { error: 'Ungültige Anfrage' })
  }
  const day = /^\d{4}-\d{2}-\d{2}$/

  try {
    const tok = await token()
    if (body.action === 'users') return reply(200, await readAll(tok, ['users', 'user']))
    if (body.action === 'tasks') return reply(200, await readAll(tok, ['tasks', 'task']))
    if (body.action === 'trackings') {
      if (!day.test(body.from ?? '') || !day.test(body.to ?? '')) return reply(400, { error: 'Zeitraum fehlt' })
      return reply(200, await readAll(tok, ['timeTrackings', 'timeTracking'], {
        _op__start_time: 'betw',
        start_time: `${body.from} 00:00:00|${body.to} 23:59:59`,
      }))
    }
    if (body.action === 'absences') {
      if (!day.test(body.from ?? '') || !day.test(body.to ?? '')) return reply(400, { error: 'Zeitraum fehlt' })
      return reply(200, await readAll(tok, ['absenceDays', 'absenceDay'], { _op__date: 'betw', date: `${body.from}|${body.to}` }))
    }
    // Abwesenheitsanträge, die den Zeitraum berühren: liefern den Genehmiger (granted_user_id, granted_timestamp)
    if (body.action === 'requests') {
      if (!day.test(body.from ?? '') || !day.test(body.to ?? '')) return reply(400, { error: 'Zeitraum fehlt' })
      return reply(200, await readAll(tok, ['absences', 'absence'], {
        _op__from_date: 'lte',
        from_date: body.to!,
        _op__to_date: 'gte',
        to_date: body.from!,
      }))
    }
  } catch (err) {
    return reply(502, { error: (err as Error).message })
  }
  return reply(400, { error: 'Unbekannte Aktion' })
})
