import { useEffect, useRef, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Ticket } from '../lib/types'

const km = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

// Fahrstrecke bei Beanstandungen (Hauptstandort → Kunde → zurück). Wird automatisch berechnet,
// sobald eine Adresse da ist, die noch nicht berechnet wurde (Edge Function calc-distance).
export function DistanceLine({ ticket, onChanged }: { ticket: Ticket; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const asked = useRef('')
  const address = ticket.site_address.trim()
  const stale = !!address && ticket.distance_address !== address

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

  if (!address) return <p className="distance small muted">Fahrstrecke: Bitte zuerst die Kundenadresse eintragen.</p>

  return (
    <p className="distance small">
      <span>Fahrstrecke ab Hauptstandort (hin und zurück): </span>
      {busy || (stale && !error) ? (
        <span className="muted">wird berechnet…</span>
      ) : ticket.distance_km != null ? (
        <strong>{km(ticket.distance_km)} km</strong>
      ) : (
        <span className="appointment-warn">{error || ticket.distance_error || 'nicht berechnet'}</span>
      )}
      {!busy && (!stale || error) && (
        <button className="link" onClick={calc}>Neu berechnen</button>
      )}
    </p>
  )
}
