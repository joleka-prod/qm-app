// Berechnet bei Beanstandungen die Fahrstrecke vom Hauptstandort zur Kundenadresse (Hin- und Rückweg)
// und speichert sie am Auftrag. Adressen werden über OpenStreetMap-Daten gefunden (Photon, ersatzweise
// Nominatim), die Strecke über OSRM (ersatzweise der OSRM-Server der FOSSGIS). Alles kostenlos, ohne Schlüssel.
// Optional: ORIGIN_ADDRESS (Standard: Hauptstandort), PHOTON_URL, NOMINATIM_URL, OSRM_URL, OSRM_URL_2 (Tests).
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ORIGIN = Deno.env.get('ORIGIN_ADDRESS') ?? 'Hauptstraße 2, 54570 Kalenborn-Scheuern'
const PHOTON = Deno.env.get('PHOTON_URL') ?? 'https://photon.komoot.io'
const NOMINATIM = Deno.env.get('NOMINATIM_URL') ?? 'https://nominatim.openstreetmap.org'
const OSRM = [
  Deno.env.get('OSRM_URL') ?? 'https://router.project-osrm.org/route/v1/driving',
  Deno.env.get('OSRM_URL_2') ?? 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
]
const AGENT = 'JOLEKA-Service-Dashboard/1.0'

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

type Point = { lat: string; lon: string }

// Erst Photon (bevorzugt Treffer rund um die Eifel), sonst Nominatim. null = Adresse nicht gefunden
async function geocode(address: string): Promise<Point | null> {
  const headers = { 'User-Agent': AGENT, 'Accept-Language': 'de' }
  let status = 0
  try {
    const res = await fetch(`${PHOTON}/api/?limit=1&lang=de&lat=50.2&lon=6.8&q=${encodeURIComponent(address)}`, { headers })
    status = res.status
    if (res.ok) {
      const data = await res.json()
      const c = data.features?.[0]?.geometry?.coordinates
      if (c) return { lon: String(c[0]), lat: String(c[1]) }
    }
  } catch {
    // weiter mit Nominatim
  }
  const res = await fetch(`${NOMINATIM}/search?format=json&limit=1&countrycodes=de,lu,be,nl,fr&q=${encodeURIComponent(address)}`, { headers })
  if (res.ok) return ((await res.json()) as Point[])[0] ?? null
  if (status === 200) return null
  throw new Error(`Adresssuche nicht erreichbar (${status || '-'} / ${res.status})`)
}

// Einfache Strecke in Metern
async function route(a: Point, b: Point) {
  let last = ''
  for (const base of OSRM) {
    try {
      const res = await fetch(`${base}/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`, { headers: { 'User-Agent': AGENT } })
      if (!res.ok) {
        last = String(res.status)
        continue
      }
      const data = await res.json()
      if (data.code === 'Ok' && data.routes?.length) return data.routes[0].distance as number
      last = data.code
    } catch (e) {
      last = e instanceof Error ? e.message : 'Fehler'
    }
  }
  throw new Error(`Keine Route zur Kundenadresse gefunden (${last}).`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'Nur POST erlaubt' })

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const auth = req.headers.get('Authorization') ?? ''
  const { data: caller } = await admin.auth.getUser(auth.replace(/^Bearer /, ''))
  if (!caller.user) return reply(401, { error: 'Nicht angemeldet' })

  let body: { ticket_id?: number }
  try {
    body = await req.json()
  } catch {
    return reply(400, { error: 'Ungültige Anfrage' })
  }

  // Nur wer den Auftrag sehen darf (Zeilenrechte des Aufrufers)
  const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: auth } },
  })
  const { data: t } = await user.from('tickets').select('id, ticket_type, site_address').eq('id', body.ticket_id ?? 0).maybeSingle()
  if (!t) return reply(404, { error: 'Auftrag nicht gefunden' })
  if (t.ticket_type !== 'beanstandung') return reply(400, { error: 'Die Fahrstrecke gibt es nur bei Beanstandungen.' })

  const address = (t.site_address ?? '').trim()
  const save = async (km: number | null, error: string) => {
    await admin.from('tickets').update({ distance_km: km, distance_address: address, distance_error: error }).eq('id', t.id).eq('site_address', t.site_address)
    return reply(200, { distance_km: km, distance_error: error })
  }
  if (!address) return save(null, '')

  try {
    const from = await geocode(ORIGIN)
    if (!from) throw new Error('Hauptstandort wurde nicht gefunden.')
    const to = await geocode(address.replace(/\s*\n\s*/g, ', '))
    if (!to) return save(null, 'Kundenadresse wurde nicht gefunden. Bitte Straße, PLZ und Ort prüfen.')
    const meters = await route(from, to)
    return save(Math.round((meters * 2) / 100) / 10, '')
  } catch (e) {
    return save(null, e instanceof Error ? e.message : 'Fahrstrecke konnte nicht berechnet werden.')
  }
})
