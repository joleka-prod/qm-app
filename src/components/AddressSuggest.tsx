import { useEffect, useState } from 'react'

// Adressvorschläge beim Tippen (OpenStreetMap über Photon, kostenlos, ohne Schlüssel).
// Bevorzugt Treffer rund um die Eifel; Auswahl füllt Straße, Hausnummer, PLZ, Ort und Land.
const PHOTON = 'https://photon.komoot.io/api/'

export interface PickedAddress {
  street: string
  house_no: string
  zip: string
  city: string
  country: string
}

interface Suggestion extends PickedAddress {
  label: string
}

interface PhotonFeature {
  properties: {
    type?: string
    name?: string
    street?: string
    housenumber?: string
    postcode?: string
    city?: string
    town?: string
    village?: string
    district?: string
    country?: string
  }
}

function toSuggestion(f: PhotonFeature): Suggestion | null {
  const p = f.properties
  const street = p.street ?? (p.type === 'street' ? p.name : '')
  if (!street) return null
  const city = p.city ?? p.town ?? p.village ?? p.district ?? ''
  const s = { street, house_no: p.housenumber ?? '', zip: p.postcode ?? '', city, country: p.country ?? '' }
  const label = [`${s.street} ${s.house_no}`.trim(), `${s.zip} ${s.city}`.trim(), s.country === 'Deutschland' ? '' : s.country]
    .filter(Boolean)
    .join(', ')
  return { ...s, label }
}

export function AddressSuggest({ query, active, onPick }: { query: string; active: boolean; onPick: (a: PickedAddress) => void }) {
  const [list, setList] = useState<Suggestion[]>([])
  const q = query.trim()

  useEffect(() => {
    if (!active || q.length < 4) {
      setList([])
      return
    }
    const ctrl = new AbortController()
    // Erst suchen, wenn kurz nicht mehr getippt wird
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${PHOTON}?q=${encodeURIComponent(q)}&limit=6&lang=de&lat=50.2&lon=6.8&layer=house&layer=street`, {
          signal: ctrl.signal,
        })
        if (!res.ok) return
        const data = (await res.json()) as { features?: PhotonFeature[] }
        const seen = new Set<string>()
        const out: Suggestion[] = []
        for (const f of data.features ?? []) {
          const s = toSuggestion(f)
          if (s && !seen.has(s.label)) {
            seen.add(s.label)
            out.push(s)
          }
        }
        setList(out)
      } catch {
        // Suche nicht erreichbar oder abgebrochen: keine Vorschläge
      }
    }, 350)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [q, active])

  if (!active || list.length === 0) return null
  return (
    <ul className="address-suggest" role="listbox">
      {list.map((s) => (
        <li key={s.label}>
          <button
            type="button"
            // mousedown statt click, damit das Feld nicht vorher den Fokus verliert
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(s)
              setList([])
            }}
          >
            {s.label}
          </button>
        </li>
      ))}
    </ul>
  )
}
