// Benutzerverwaltung für QM/Admin: Benutzer anlegen und Passwort neu setzen.
// Läuft als Supabase Edge Function, weil dafür der geheime Service-Schlüssel nötig ist,
// der nie im Browser landen darf. Aufrufer muss als aktiver Admin angemeldet sein.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ROLES = ['mitarbeiter', 'teamleiter', 'admin']

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'Nur POST erlaubt' })

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  // Aufrufer prüfen
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
  const { data: caller } = await admin.auth.getUser(token)
  if (!caller.user) return reply(401, { error: 'Nicht angemeldet' })
  const { data: me } = await admin.from('profiles').select('role, active').eq('id', caller.user.id).single()
  if (!me || me.role !== 'admin' || !me.active) return reply(403, { error: 'Nur für QM/Admin' })

  let body: Record<string, string>
  try {
    body = await req.json()
  } catch {
    return reply(400, { error: 'Ungültige Anfrage' })
  }

  const password = (body.password ?? '').trim()
  if (password.length < 8) return reply(400, { error: 'Das Passwort muss mindestens 8 Zeichen haben.' })

  if (body.action === 'create') {
    const email = (body.email ?? '').trim().toLowerCase()
    const fullName = (body.full_name ?? '').trim()
    const role = body.role ?? 'mitarbeiter'
    if (!email.includes('@')) return reply(400, { error: 'Bitte eine gültige E-Mail-Adresse angeben.' })
    if (!ROLES.includes(role)) return reply(400, { error: 'Unbekannte Rolle' })

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (error) {
      const msg = /already/i.test(error.message) ? 'Diese E-Mail-Adresse ist bereits registriert.' : error.message
      return reply(400, { error: msg })
    }
    const { error: profErr } = await admin
      .from('profiles')
      .update({ role, full_name: fullName })
      .eq('id', data.user.id)
    if (profErr) return reply(500, { error: profErr.message })
    return reply(200, { id: data.user.id })
  }

  if (body.action === 'set_password') {
    if (!body.user_id) return reply(400, { error: 'Benutzer fehlt' })
    const { error } = await admin.auth.admin.updateUserById(body.user_id, { password })
    if (error) return reply(400, { error: error.message })
    return reply(200, { ok: true })
  }

  return reply(400, { error: 'Unbekannte Aktion' })
})
