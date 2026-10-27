import { useEffect, useRef, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Ticket } from '../lib/types'
import type { ProjectAddress } from '../lib/projects'
import { jobAddress } from './AddressFields'

// Fahrzeit wie "1 Std. 25 Min."
const duration = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} Std. ${m % 60} Min.` : `${m} Min.`)

const km = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

// Fahrstrecke bei Service-Aufträgen (Hauptstandort → Bauvorhaben → zurück). Wird automatisch berechnet,
// sobald eine Adresse da ist, die noch nicht berechnet wurde (Edge Function calc-distance).
export function DistanceLine({ ticket, project, onChanged }: { ticket: Ticket; project: ProjectAddress | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const asked = useRef('')
  const address = jobAddress({ site_address: ticket.site_address, project })
  const toProject = address !== ticket.site_address.trim()
  // auch neu rechnen, wenn nur die Fahrzeit noch fehlt (ältere Berechnungen)
  const stale = !!address && (ticket.distance_address !== address || (ticket.distance_km != null && ticket.distance_minutes == null))

  async function calc() {
    setBusy(true)
    setError('')
    const { error } = await supabase.functions.invoke('calc-distance', { body: { ticket_id: ticket.id } })
    if (error) {
      const payload = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null
      setError(payload?.error ?? 'Fahrstrecke nicht erreichbar. Ist die Funktion „calc-distance“ in Supabase eingerichtet?')
    }
    setBusy(false)
    onChanged()
  }

  useEffect(() => {
    const key = `${ticket.id}:${address}`
    if (stale && asked.current !== key) {
      asked.current = key
      calc()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id, address, stale])

  if (!address) return <p className="distance small muted">Fahrstrecke: Bitte zuerst die Adresse des Bauvorhabens oder des Kunden eintragen.</p>

  return (
    <p className="distance small">
      <span>Fahrstrecke ab Kalenborn-Scheuern (hin und zurück): </span>
      {busy || (stale && !error) ? (
        <span className="muted">wird berechnet…</span>
      ) : ticket.distance_km != null ? (
        <>
          <strong>{km(ticket.distance_km)} km</strong>
          {ticket.distance_minutes != null && <> · Fahrzeit ca. <strong>{duration(ticket.distance_minutes)}</strong></>}
        </>
      ) : (
        <span className="appointment-warn">{error || ticket.distance_error || 'nicht berechnet'}</span>
      )}
      {!busy && (!stale || error) && (
        <button className="link" onClick={calc}>Neu berechnen</button>
      )}
      <span className="distance-target muted">
        zum {toProject ? 'Bauvorhaben' : 'Kunden'}: {address.replace(/\s*\n\s*/g, ', ')}
      </span>
    </p>
  )
}
