import { useEffect, useState } from 'react'
import { formatMinutes } from '../lib/clock'
import { supabase } from '../lib/supabase'
import { formatDay } from '../lib/types'

interface Balance {
  since: string
  until: string
  target_min: number
  actual_min: number
  opening_min: number
  balance_min: number
  planned_min: number
  requested_min: number
}

const signed = (m: number) => `${m < 0 ? '−' : '+'}${formatMinutes(Math.abs(m))}`

// Überstundenkonto: Übertrag + gestempelte Zeit − Soll (Wochenarbeitszeit, ohne Feiertage und Urlaub), Stand gestern
export function OvertimeCard({ userId, reloadKey }: { userId: string; reloadKey?: unknown }) {
  const [b, setB] = useState<Balance | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.rpc('overtime_balance', { p_user: userId }).then(({ data, error }) => {
      setError(error ? 'Überstunden konnten nicht berechnet werden.' : '')
      setB(((data ?? []) as Balance[])[0] ?? null)
    })
  }, [userId, reloadKey])

  if (error) return <p className="small muted">{error}</p>
  if (!b) return null
  const empty = b.until < b.since

  return (
    <section className="card overtime">
      <div className="overtime-head">
        <h2>Überstunden</h2>
        <strong className={b.balance_min < 0 ? 'overtime-minus' : 'overtime-plus'}>{signed(b.balance_min)}</strong>
      </div>
      <p className="small muted">
        {empty ? (
          <>Das Stundenkonto beginnt am {formatDay(b.since)}.</>
        ) : (
          <>
            Stand {formatDay(b.until)} · seit {formatDay(b.since)}: gearbeitet {formatMinutes(b.actual_min)}, Soll {formatMinutes(b.target_min)}
            {b.opening_min !== 0 && <>, Übertrag {signed(b.opening_min)}</>}
          </>
        )}
      </p>
      {(b.planned_min > 0 || b.requested_min > 0) && (
        <p className="small">
          Für Freizeit verplant: {b.planned_min > 0 && <>{formatMinutes(b.planned_min)} genehmigt</>}
          {b.planned_min > 0 && b.requested_min > 0 && ' · '}
          {b.requested_min > 0 && <>{formatMinutes(b.requested_min)} beantragt</>}
          {' · '}danach frei verfügbar{' '}
          <strong className={b.balance_min - b.planned_min - b.requested_min < 0 ? 'overtime-minus' : ''}>
            {signed(b.balance_min - b.planned_min - b.requested_min)}
          </strong>
        </p>
      )}
    </section>
  )
}
