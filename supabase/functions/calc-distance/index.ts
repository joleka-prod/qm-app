// Berechnet bei Aufträgen (nicht QM) die Fahrstrecke vom Hauptstandort zur Kundenadresse (Hin- und Rückweg)
// (bei abweichender Baustellenadresse zur Baustelle) und speichert sie am Auftrag. Adressen werden über OpenStreetMap-Daten gefunden (Photon, ersatzweise
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
// Treffer der Adresssuche; exact = Straße bzw. Hausnummer gefunden (nicht nur Ort)
type Hit = Point & { exact: boolean; postcode: string; housenumber: string; street: string; label: string }

const COUNTRIES = 'de,at,ch,lu,be,nl,fr'

// Erst Photon (bevorzugt Treffer rund um die Eifel), sonst Nominatim. null = Adresse nicht gefunden
async function lookup(address: string): Promise<Hit | null> {
  const headers = { 'User-Agent': AGENT, 'Accept-Language': 'de' }
  let status = 0
  try {
    const res = await fetch(`${PHOTON}/api/?limit=1&lang=de&lat=50.2&lon=6.8&q=${encodeURIComponent(address)}`, { headers })
    status = res.status
    if (res.ok) {
      const f = (await res.json()).features?.[0]
      const c = f?.geometry?.coordinates
      if (c) {
        const p = f.properties ?? {}
        const street = p.street ?? (p.type === 'street' ? p.name : '')
        return {
          lon: String(c[0]), lat: String(c[1]),
          exact: ['house', 'street'].includes(p.type) || !!p.housenumber,
          postcode: p.postcode ?? '',
          housenumber: p.housenumber ?? '',
          street: street ?? '',
          label: [`${street ?? ''} ${p.housenumber ?? ''}`.trim(), `${p.postcode ?? ''} ${p.city ?? p.name ?? ''}`.trim()].filter(Boolean).join(', '),
        }
      }
    }
  } catch {
    // weiter mit Nominatim
  }
  const res = await fetch(`${NOMINATIM}/search?format=json&limit=1&addressdetails=1&countrycodes=${COUNTRIES}&q=${encodeURIComponent(address)}`, { headers })
  if (res.ok) {
    const r = (await res.json())[0]
    if (!r) return null
    const a = r.address ?? {}
    return {
      lat: r.lat, lon: r.lon,
      exact: !!(a.road || a.house_number),
      postcode: a.postcode ?? '',
      housenumber: a.house_number ?? '',
      street: a.road ?? '',
      label: [`${a.road ?? ''} ${a.house_number ?? ''}`.trim(), `${a.postcode ?? ''} ${a.city ?? a.town ?? a.village ?? ''}`.trim()].filter(Boolean).join(', '),
    }
  }
  if (status === 200) return null
  throw new Error(`Adresssuche nicht erreichbar (${status || '-'} / ${res.status})`)
}

// Straßennamen vergleichbar machen: "Hauptstr." = "Hauptstraße" = "Haupt-Straße"
function streetKey(x: string) {
  return x
    .toLowerCase()
    .replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/str\.?(\s|$)/g, 'strasse$1')
    .replace(/[^a-z0-9]/g, '')
}

// Kleine Tippfehler (1 Zeichen je 8) gelten noch als gleiche Straße
function sameStreet(a: string, b: string) {
  const x = streetKey(a)
  const y = streetKey(b)
  if (!x || !y) return false
  if (x === y) return true
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)])
  for (let j = 1; j <= y.length; j++) d[0][j] = j
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1))
  return d[x.length][y.length] <= Math.floor(Math.max(x.length, y.length) / 8)
}

async function geocode(address: string): Promise<Point | null> {
  return await lookup(address)
}

// Einfache Strecke: Meter und Sekunden
async function route(a: Point, b: Point): Promise<{ distance: number; duration: number }> {
  let last = ''
  for (const base of OSRM) {
    try {
      const res = await fetch(`${base}/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`, { headers: { 'User-Agent': AGENT } })
      if (!res.ok) {
        last = String(res.status)
        continue
      }
      const data = await res.json()
      if (data.code === 'Ok' && data.routes?.length) return { distance: data.routes[0].distance, duration: data.routes[0].duration }
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

  let body: { ticket_id?: number; action?: string; street?: string; house_no?: string; zip?: string; city?: string; country?: string }
  try {
    body = await req.json()
  } catch {
    return reply(400, { error: 'Ungültige Anfrage' })
  }

  // Adressprüfung beim Speichern: findet die Navigation diese Adresse?
  if (body.action === 'check') {
    const v = (x?: string) => (x ?? '').trim()
    const country = v(body.country)
    const query = [`${v(body.street)} ${v(body.house_no)}`.trim(), `${v(body.zip)} ${v(body.city)}`.trim(), country]
      .filter(Boolean).join(', ')
    if (!query) return reply(200, { found: true, label: '' })
    try {
      const hit = await lookup(query)
      if (!hit || (v(body.street) && !hit.exact)) return reply(200, { found: false, reason: '', label: hit?.label ?? '' })
      const norm = (x: string) => x.toLowerCase().replace(/\s+/g, '')
      if (v(body.street) && !sameStreet(hit.street, v(body.street))) {
        return reply(200, { found: false, reason: 'Diese Straße wurde im Ort nicht gefunden.', label: hit.label })
      }
      if (v(body.zip) && hit.postcode && norm(hit.postcode) !== norm(v(body.zip))) {
        return reply(200, { found: false, reason: 'Die PLZ passt nicht zur Straße.', label: hit.label })
      }
      if (v(body.house_no) && norm(hit.housenumber) !== norm(v(body.house_no))) {
        return reply(200, { found: false, reason: 'Diese Hausnummer wurde in der Straße nicht gefunden.', label: hit.label })
      }
      return reply(200, { found: true, label: hit.label })
    } catch (e) {
      return reply(200, { found: null, error: e instanceof Error ? e.message : 'Adresssuche nicht erreichbar' })
    }
  }

  // Nur wer den Auftrag sehen darf (Zeilenrechte des Aufrufers)
  const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: auth } },
  })
  const { data: t } = await user.from('tickets').select('id, ticket_type, site_address, jobsite_address_different, jobsite_street, jobsite_house_no, jobsite_zip, jobsite_city, jobsite_country').eq('id', body.ticket_id ?? 0).maybeSingle()
  if (!t) return reply(404, { error: 'Auftrag nicht gefunden' })
  if (t.ticket_type === 'qm') return reply(400, { error: 'Die Fahrstrecke gibt es nur bei Aufträgen.' })

  // Einsatzort: abweichende Baustelle, sonst Kundenadresse (gleiche Schreibweise wie in der App)
  const address = t.jobsite_address_different
    ? [`${t.jobsite_street} ${t.jobsite_house_no}`.trim(), `${t.jobsite_zip} ${t.jobsite_city}`.trim(), t.jobsite_country === 'Deutschland' ? '' : t.jobsite_country]
      .filter(Boolean).join('\n')
    : (t.site_address ?? '').trim()
  const save = async (km: number | null, error: string, minutes: number | null = null) => {
    await admin.from('tickets').update({ distance_km: km, distance_minutes: minutes, distance_address: address, distance_error: error }).eq('id', t.id)
      .eq('site_address', t.site_address).eq('jobsite_address_different', t.jobsite_address_different)
      .eq('jobsite_street', t.jobsite_street).eq('jobsite_house_no', t.jobsite_house_no)
      .eq('jobsite_zip', t.jobsite_zip).eq('jobsite_city', t.jobsite_city).eq('jobsite_country', t.jobsite_country)
    return reply(200, { distance_km: km, distance_minutes: minutes, distance_error: error })
  }
  if (!address) return save(null, '')

  try {
    const from = await geocode(ORIGIN)
    if (!from) throw new Error('Hauptstandort wurde nicht gefunden.')
    const to = await geocode(address.replace(/\s*\n\s*/g, ', '))
    if (!to) return save(null, 'Kundenadresse wurde nicht gefunden. Bitte Straße, PLZ und Ort prüfen.')
    const r = await route(from, to)
    // hin und zurück
    return save(Math.round((r.distance * 2) / 100) / 10, '', Math.round((r.duration * 2) / 60))
  } catch (e) {
    return save(null, e instanceof Error ? e.message : 'Fahrstrecke konnte nicht berechnet werden.')
  }
})
