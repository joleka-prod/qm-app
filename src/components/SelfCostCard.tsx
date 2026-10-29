import { useCallback, useEffect, useState } from 'react'
import { formatMinutes } from '../lib/clock'
import { supabase } from '../lib/supabase'
import { displayName, formatDate, type Profile, type Ticket } from '../lib/types'

interface Costs {
  km: number
  km_rate: number
  km_cost: number
  work_minutes: number
  hour_rate: number
  work_cost: number
  positions_cost: number
  positions_without_price: number
  total: number
  calculated_by: string | null
  calculated_at: string
}

const eur = (v: number) => Number(v).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
const num = (v: number, d = 1) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })

// Selbstkosten einer abgeschlossenen Beanstandung: Fahrstrecke, Arbeitszeit und Positionspreise (Berechnung in calc_self_cost)
export function SelfCostCard({ ticket, byId, onChanged }: { ticket: Ticket; byId: Record<string, Profile>; onChanged: () => void }) {
  const [costs, setCosts] = useState<Costs | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('ticket_costs').select('*').eq('ticket_id', ticket.id).maybeSingle()
    setCosts(data as Costs | null)
  }, [ticket.id])

  useEffect(() => {
    load()
  }, [load])

  async function calc() {
    setBusy(true)
    setError('')
    const { data, error } = await supabase.rpc('calc_self_cost', { p_ticket_id: ticket.id })
    if (error) setError(error.message)
    else setCosts(data as Costs)
    setBusy(false)
    onChanged()
  }

  return (
    <section className="card self-cost">
      <h2>Selbstkosten</h2>
      {costs ? (
        <>
          <table className="cost-table">
            <tbody>
              <tr>
                <td>Fahrstrecke</td>
                <td className="muted">{num(costs.km)} km × {eur(costs.km_rate)}</td>
                <td>{eur(costs.km_cost)}</td>
              </tr>
              <tr>
                <td>Arbeitszeit</td>
                <td className="muted">{formatMinutes(costs.work_minutes)} × {eur(costs.hour_rate)}/Std.</td>
                <td>{eur(costs.work_cost)}</td>
              </tr>
              <tr>
                <td>Positionen</td>
                <td className="muted">
                  {costs.positions_without_price > 0 && `${costs.positions_without_price} ohne Preis`}
                </td>
                <td>{eur(costs.positions_cost)}</td>
              </tr>
              <tr className="cost-total">
                <td colSpan={2}>Selbstkosten gesamt</td>
                <td>{eur(costs.total)}</td>
              </tr>
            </tbody>
          </table>
          <p className="small muted">
            Berechnet am {formatDate(costs.calculated_at)}
            {costs.calculated_by && <> von {displayName(byId[costs.calculated_by])}</>}
          </p>
        </>
      ) : (
        <p className="small muted">Fahrstrecke × 0,39 €/km + Arbeitszeit aller Monteure × 42,00 €/Std. + Positionspreise.</p>
      )}
      {ticket.distance_km == null && <p className="small appointment-warn">Die Fahrstrecke ist noch nicht berechnet.</p>}
      <button className={costs ? '' : 'primary'} disabled={busy || ticket.distance_km == null} onClick={calc}>
        {busy ? 'Berechnet…' : costs ? 'Neu berechnen' : 'Selbstkosten berechnen'}
      </button>
      {error && <p className="error">{error}</p>}
    </section>
  )
}
