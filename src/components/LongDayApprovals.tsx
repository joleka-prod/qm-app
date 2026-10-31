import { useCallback, useEffect, useState } from 'react'
import { clockTime, formatMinutes, workMinutes, type Attendance } from '../lib/clock'
import { supabase } from '../lib/supabase'
import { displayName, formatDate, formatDay, isoDate, type Profile } from '../lib/types'
import { toLocalInput } from './TimeCard'

export interface LongDayReview {
  id: number
  user_id: string
  day: string
  work_min: number
  state: 'offen' | 'freigegeben' | 'korrigiert'
  decided_by: string | null
  decided_at: string | null
  decision_note: string
  decided_work_min: number | null
}

export const LONG_DAY_STATE: Record<LongDayReview['state'], string> = {
  offen: 'Wartet auf Freigabe',
  freigegeben: 'Freigegeben',
  korrigiert: 'Korrigiert',
}

// Darf ich als Vorgesetzte(r) (ganze Kette) oder Admin über diese Person entscheiden? Nie über mich selbst.
export function canDecideFor(me: Profile, byId: Record<string, Profile>, userId: string) {
  if (userId === me.id) return false
  if (me.role === 'admin') return true
  let up = byId[userId]?.supervisor_id
  for (let i = 0; up && i < 10; i++, up = byId[up]?.supervisor_id) if (up === me.id) return true
  return false
}

// Anzahl der offenen Meldungen, über die ich entscheiden kann (für Hinweis und Reiter)
export function useLongDayCount(me: Profile | null, byId: Record<string, Profile>, reloadKey?: unknown) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!me) return
    let alive = true
    supabase
      .from('long_day_reviews')
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

type Action = { id: number; kind: 'freigeben' | 'korrigieren'; note: string; times: Record<number, { start: string; end: string }> }

// Arbeitstage über 10 Stunden, die ich freigeben oder korrigieren muss
export function LongDayApprovals({ me, byId, onChanged }: { me: Profile; byId: Record<string, Profile>; onChanged: () => void }) {
  const [list, setList] = useState<LongDayReview[]>([])
  const [stamps, setStamps] = useState<Record<string, Attendance[]>>({})
  const [action, setAction] = useState<Action | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('long_day_reviews').select('*').eq('state', 'offen').neq('user_id', me.id).order('day')
    const open = ((data ?? []) as LongDayReview[]).filter((r) => canDecideFor(me, byId, r.user_id))
    setList(open)
    if (!open.length) return setStamps({})
    // Stempelzeiten der betroffenen Tage (etwas weiter gefasst wegen Zeitzone, danach nach Tag sortiert)
    const from = new Date(`${open[0].day}T00:00`)
    from.setDate(from.getDate() - 1)
    const to = new Date(`${open.at(-1)!.day}T23:59:59`)
    to.setDate(to.getDate() + 1)
    const { data: att } = await supabase
      .from('attendance')
      .select('*')
      .in('installer_id', [...new Set(open.map((r) => r.user_id))])
      .gte('started_at', from.toISOString())
      .lte('started_at', to.toISOString())
      .order('started_at')
    const m: Record<string, Attendance[]> = {}
    for (const a of (att ?? []) as Attendance[]) (m[`${a.installer_id}|${isoDate(new Date(a.started_at))}`] ??= []).push(a)
    setStamps(m)
  }, [me, byId])

  useEffect(() => {
    load()
  }, [load])

  const rowsOf = (r: LongDayReview) => (stamps[`${r.user_id}|${r.day}`] ?? []).filter((a) => a.ended_at)

  function open(r: LongDayReview, kind: Action['kind']) {
    setError('')
    const times: Action['times'] = {}
    for (const a of rowsOf(r)) times[a.id] = { start: toLocalInput(a.started_at), end: toLocalInput(a.ended_at) }
    setAction({ id: r.id, kind, note: '', times })
  }

  // Arbeitszeit des Tages mit den eingegebenen (noch nicht gespeicherten) Zeiten
  function previewMinutes(r: LongDayReview) {
    if (!action) return r.work_min
    return rowsOf(r).reduce((sum, a) => {
      const t = action.times[a.id]
      if (!t?.start || !t?.end) return sum
      return sum + workMinutes(new Date(t.start).toISOString(), new Date(t.end).toISOString())
    }, 0)
  }

  async function save(r: LongDayReview) {
    if (!action) return
    setBusy(true)
    setError('')
    const note = action.note.trim()
    let res
    if (action.kind === 'freigeben') {
      res = await supabase.rpc('approve_long_day', { p_id: r.id, p_note: note })
    } else {
      const changes = rowsOf(r).map((a) => ({
        id: a.id,
        start: new Date(action.times[a.id].start).toISOString(),
        end: new Date(action.times[a.id].end).toISOString(),
      }))
      res = await supabase.rpc('correct_long_day', { p_id: r.id, p_changes: changes, p_note: note })
    }
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
        <h2>Über 10 Stunden gearbeitet – Freigabe nötig</h2>
      </div>
      <p className="small muted">
        Arbeitszeit ohne die festen Pausen. Gib den Tag mit Begründung frei oder korrigiere die Stempelzeiten mit Begründung; der Mitarbeiter bekommt
        eine Korrektur als Info in seiner Zeiterfassung.
      </p>
      <div className="cal-scroll">
        <table className="import-table">
          <thead>
            <tr>
              <th>Mitarbeiter</th>
              <th>Tag</th>
              <th className="num">Arbeitszeit</th>
              <th>Stempelzeiten</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const active = action?.id === r.id ? action : null
              const preview = active?.kind === 'korrigieren' ? previewMinutes(r) : null
              return (
                <tr key={r.id}>
                  <td>{displayName(byId[r.user_id])}</td>
                  <td>{formatDay(r.day)}</td>
                  <td className="num"><strong>{formatMinutes(r.work_min)}</strong></td>
                  <td className="small">
                    {rowsOf(r).length === 0 && <span className="muted">–</span>}
                    {!active || active.kind === 'freigeben'
                      ? rowsOf(r).map((a) => (
                          <div key={a.id}>
                            {clockTime(a.started_at)} – {a.ended_at ? clockTime(a.ended_at) : '…'}
                            {a.note?.startsWith('TimeTac') && <span className="muted"> (TimeTac)</span>}
                          </div>
                        ))
                      : rowsOf(r).map((a) => (
                          <div key={a.id} className="ts-edit-row">
                            <input
                              type="datetime-local"
                              value={active.times[a.id]?.start ?? ''}
                              onChange={(e) => setAction({ ...active, times: { ...active.times, [a.id]: { ...active.times[a.id], start: e.target.value } } })}
                            />
                            {' – '}
                            <input
                              type="datetime-local"
                              value={active.times[a.id]?.end ?? ''}
                              onChange={(e) => setAction({ ...active, times: { ...active.times, [a.id]: { ...active.times[a.id], end: e.target.value } } })}
                            />
                          </div>
                        ))}
                    {preview !== null && <div className="muted">Neue Arbeitszeit: {formatMinutes(preview)}</div>}
                    {active && (
                      <div className="form">
                        <label>
                          Begründung *
                          <input
                            autoFocus
                            value={active.note}
                            maxLength={300}
                            onChange={(e) => setAction({ ...active, note: e.target.value })}
                            placeholder={active.kind === 'freigeben' ? 'z. B. Notfall beim Kunden, abgesprochen' : 'z. B. Ausstempeln vergessen, Ende war 16:00 Uhr'}
                          />
                        </label>
                        <div className="actions">
                          <button disabled={busy} onClick={() => setAction(null)}>Abbrechen</button>
                          <button className="primary" disabled={busy || active.note.trim().length < 3} onClick={() => save(r)}>
                            {active.kind === 'freigeben' ? 'Freigeben' : 'Korrektur speichern'}
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                  <td>
                    {!active && (
                      <div className="vacation-actions">
                        <button disabled={busy} onClick={() => open(r, 'korrigieren')}>Korrigieren</button>
                        <button className="primary" disabled={busy} onClick={() => open(r, 'freigeben')}>Freigeben</button>
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
export function longDayText(r: LongDayReview, byId: Record<string, Profile>) {
  if (r.state === 'offen') return `Über 10 Stunden (${formatMinutes(r.work_min)}): wartet auf Freigabe durch den Vorgesetzten`
  return (
    `Über 10 Stunden: ${LONG_DAY_STATE[r.state].toLowerCase()} von ${displayName(byId[r.decided_by ?? ''])}` +
    (r.decided_at ? ` am ${formatDate(r.decided_at)}` : '') +
    (r.decision_note ? ` · ${r.decision_note}` : '')
  )
}
