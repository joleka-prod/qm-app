import { useCallback, useEffect, useState } from 'react'
import { clockTime } from '../lib/clock'
import { rejectReason } from '../lib/rejectReason'
import { supabase } from '../lib/supabase'
import { displayName, formatDay, isoDate, type Profile } from '../lib/types'

export interface AttendanceRequest {
  id: number
  user_id: string
  attendance_id: number | null
  started_at: string
  ended_at: string
  old_started_at: string | null
  old_ended_at: string | null
  reason: string
  state: 'beantragt' | 'genehmigt' | 'abgelehnt' | 'storniert'
  requested_by: string
  decided_by: string | null
  decided_at: string | null
  decision_note: string
}

export const span = (a: string, b: string | null) => `${clockTime(a)} – ${b ? clockTime(b) : '…'}`

// Beschreibung eines Nachtrags bzw. einer Korrektur, z. B. "Mo., 20.10.2026: 06:00 – 15:00 (vorher 06:00 – 14:30)"
export function requestText(r: AttendanceRequest) {
  return (
    `${formatDay(isoDate(new Date(r.started_at)))}: ${span(r.started_at, r.ended_at)}` +
    (r.old_started_at ? ` (vorher ${span(r.old_started_at, r.old_ended_at)})` : ' (nachgetragen)')
  )
}

// Offene Zeitnachträge, die ich als Vorgesetzte(r) oder Admin genehmigen kann
export function AttendanceApprovals({ me, byId, onChanged }: { me: Profile; byId: Record<string, Profile>; onChanged: () => void }) {
  const [list, setList] = useState<AttendanceRequest[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('attendance_requests').select('*').eq('state', 'beantragt').neq('user_id', me.id).order('started_at')
    setList((data ?? []) as AttendanceRequest[])
  }, [me.id])

  useEffect(() => {
    load()
  }, [load])

  const canDecide = (r: AttendanceRequest) => {
    if (r.user_id === me.id) return false
    if (me.role === 'admin') return true
    let up = byId[r.user_id]?.supervisor_id
    for (let i = 0; up && i < 10; i++, up = byId[up]?.supervisor_id) if (up === me.id) return true
    return false
  }

  async function decide(r: AttendanceRequest, approve: boolean) {
    const note = approve ? '' : rejectReason()
    if (note === null) return
    setBusy(true)
    setError('')
    const { error } = await supabase.rpc('decide_attendance_change', { p_id: r.id, p_approve: approve, p_note: note })
    if (error) setError(error.message)
    await load()
    onChanged()
    setBusy(false)
  }

  const mine = list.filter(canDecide)
  if (mine.length === 0) return null

  return (
    <section className="card highlight">
      <h2>Zeitnachträge zu genehmigen</h2>
      <ul className="vacation-list">
        {mine.map((r) => (
          <li key={r.id}>
            <div>
              <strong>{displayName(byId[r.user_id])}</strong>
              <div className="small">{requestText(r)}</div>
              <div className="small muted">
                Grund: {r.reason}
                {r.requested_by !== r.user_id && <> · eingetragen von {displayName(byId[r.requested_by])}</>}
              </div>
            </div>
            <div className="vacation-actions">
              <button className="primary" disabled={busy} onClick={() => decide(r, true)}>Genehmigen</button>
              <button disabled={busy} onClick={() => decide(r, false)}>Ablehnen</button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
    </section>
  )
}
