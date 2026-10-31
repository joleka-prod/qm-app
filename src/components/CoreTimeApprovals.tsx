import { useCallback, useEffect, useState } from 'react'
import { clockTime } from '../lib/clock'
import { supabase } from '../lib/supabase'
import { displayName, formatDate, formatDay, type Profile } from '../lib/types'
import { canDecideFor } from './LongDayApprovals'

export interface CoreTimeReview {
  id: number
  user_id: string
  day: string
  core_start: string
  core_end: string
  first_start: string | null
  last_end: string | null
  late_min: number
  early_min: number
  missing_min: number
  state: 'offen' | 'freigegeben'
  decided_by: string | null
  decided_at: string | null
  decision_note: string
}

const hhmm = (t: string) => t.slice(0, 5)
const mins = (m: number) => `${m} Min.`

// Kurzbeschreibung der Verletzung, z. B. "Kernzeit 07:00–15:45 · gekommen 07:20 (20 Min. zu spät) · gegangen 15:00 (45 Min. zu früh)"
export function coreTimeDetails(r: CoreTimeReview) {
  const parts = [`Kernzeit ${hhmm(r.core_start)}–${hhmm(r.core_end)}`]
  if (r.first_start) parts.push(`gekommen ${clockTime(r.first_start)}${r.late_min ? ` (${mins(r.late_min)} zu spät)` : ''}`)
  if (r.last_end) parts.push(`gegangen ${clockTime(r.last_end)}${r.early_min ? ` (${mins(r.early_min)} zu früh)` : ''}`)
  const gap = r.missing_min - r.late_min - r.early_min
  if (gap > 0) parts.push(`${mins(gap)} Lücke`)
  return parts.join(' · ')
}

// Anzahl der offenen Meldungen, über die ich entscheiden kann (für Hinweis und Reiter)
export function useCoreTimeCount(me: Profile | null, byId: Record<string, Profile>, reloadKey?: unknown) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!me) return
    let alive = true
    supabase
      .from('core_time_reviews')
      .select('id, user_id')
      .eq('state', 'offen')
      .neq('user_id', me.id)
      .then(({ data }) => {
        if (alive) setN((data ?? []).filter((r) => canDecideFor(me, byId, r.user_id)).length)
      })
    return () => {
      alive = false
    }
  }, [me, byId, reloadKey])
  return n
}

// Kernzeitverletzungen, die ich als Vorgesetzte(r) oder Admin mit Begründung freigeben muss
export function CoreTimeApprovals({ me, byId, onChanged }: { me: Profile; byId: Record<string, Profile>; onChanged: () => void }) {
  const [list, setList] = useState<CoreTimeReview[]>([])
  const [action, setAction] = useState<{ id: number; note: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('core_time_reviews').select('*').eq('state', 'offen').neq('user_id', me.id).order('day')
    setList(((data ?? []) as CoreTimeReview[]).filter((r) => canDecideFor(me, byId, r.user_id)))
  }, [me, byId])

  useEffect(() => {
    load()
  }, [load])

  async function save(r: CoreTimeReview) {
    if (!action) return
    setBusy(true)
    setError('')
    const res = await supabase.rpc('approve_core_time', { p_id: r.id, p_note: action.note.trim() })
    if (res.error) setError(res.error.message)
    else setAction(null)
    await load()
    onChanged()
    setBusy(false)
  }

  if (list.length === 0) return null

  return (
    <section className="card highlight">
      <div className="card-head">
        <h2>Kernzeit nicht eingehalten – Freigabe nötig</h2>
      </div>
      <p className="small muted">
        Minuten der Kernarbeitszeit ohne Stempelzeit (die festen Pausen zählen nicht). Gib den Tag mit Begründung frei. Stimmen die Stempelzeiten nicht,
        korrigiere sie in der Zeiterfassung des Mitarbeiters; die Meldung verschwindet dann von selbst.
      </p>
      <div className="cal-scroll">
        <table className="import-table long-day-table">
          <thead>
            <tr>
              <th>Mitarbeiter</th>
              <th>Tag</th>
              <th className="num">Fehlt</th>
              <th>Details</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const active = action?.id === r.id ? action : null
              return (
                <tr key={r.id}>
                  <td>{displayName(byId[r.user_id])}</td>
                  <td>{formatDay(r.day)}</td>
                  <td className="num"><strong>{mins(r.missing_min)}</strong></td>
                  <td className="small">
                    {coreTimeDetails(r)}
                    {active && (
                      <div className="form">
                        <label>
                          Begründung *
                          <input
                            autoFocus
                            value={active.note}
                            maxLength={300}
                            onChange={(e) => setAction({ ...active, note: e.target.value })}
                            placeholder="z. B. Arzttermin, mit mir abgesprochen"
                          />
                        </label>
                        <div className="actions">
                          <button disabled={busy} onClick={() => setAction(null)}>Abbrechen</button>
                          <button className="primary" disabled={busy || active.note.trim().length < 3} onClick={() => save(r)}>
                            Freigeben
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                  <td>
                    {!active && (
                      <div className="vacation-actions">
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => {
                            setError('')
                            setAction({ id: r.id, note: '' })
                          }}
                        >
                          Freigeben
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  )
}

// Hinweis am Tag in der Zeiterfassung: Status der Meldung
export function coreTimeText(r: CoreTimeReview, byId: Record<string, Profile>) {
  const head = `Kernzeit nicht eingehalten (${mins(r.missing_min)} fehlen: ${coreTimeDetails(r)})`
  if (r.state === 'offen') return `${head}: wartet auf Freigabe durch den Vorgesetzten`
  return (
    `${head}: freigegeben von ${displayName(byId[r.decided_by ?? ''])}` +
    (r.decided_at ? ` am ${formatDate(r.decided_at)}` : '') +
    (r.decision_note ? ` · ${r.decision_note}` : '')
  )
}
