import { useEffect, useState } from 'react'
import { clockTime, formatMinutes, workMinutes, type Attendance } from '../lib/clock'
import { supabase } from '../lib/supabase'
import { displayName, startOfWeek, type Profile } from '../lib/types'

interface Row {
  running: Attendance | null
  week: number
  today: number
  balance: number | null
  open: number
}

const signed = (m: number) => `${m < 0 ? '−' : '+'}${formatMinutes(Math.abs(m))}`

// Übersicht für Vorgesetzte: Wer ist eingestempelt, Stunden heute und diese Woche, Überstunden, offene Anträge.
// Ein Klick auf eine Zeile zeigt die Zeiterfassung dieser Person.
export function TeamOverview({ members, selected, onPick, reloadKey }: {
  members: Profile[]
  selected: string
  onPick: (id: string) => void
  reloadKey?: unknown
}) {
  const [rows, setRows] = useState<Record<string, Row>>({})
  const ids = members.map((m) => m.id).join(',')

  useEffect(() => {
    if (!ids) return
    const list = ids.split(',')
    const from = startOfWeek(new Date())
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    Promise.all([
      supabase.from('attendance').select('*').in('installer_id', list).gte('started_at', from.toISOString()),
      supabase.from('attendance_requests').select('user_id').in('user_id', list).eq('state', 'beantragt'),
      supabase.from('vacation_requests').select('user_id').in('user_id', list).eq('state', 'beantragt'),
      Promise.all(list.map((id) => supabase.rpc('overtime_balance', { p_user: id }))),
    ]).then(([att, req, vac, bal]) => {
      const now = Date.now()
      const next: Record<string, Row> = {}
      list.forEach((id, i) => {
        const mine = ((att.data ?? []) as Attendance[]).filter((a) => a.installer_id === id)
        next[id] = {
          running: mine.find((a) => !a.ended_at) ?? null,
          week: mine.reduce((s, a) => s + workMinutes(a.started_at, a.ended_at, now), 0),
          today: mine.filter((a) => new Date(a.started_at) >= midnight).reduce((s, a) => s + workMinutes(a.started_at, a.ended_at, now), 0),
          balance: (bal[i].data as { balance_min: number }[] | null)?.[0]?.balance_min ?? null,
          open: [...(req.data ?? []), ...(vac.data ?? [])].filter((r) => r.user_id === id).length,
        }
      })
      setRows(next)
    })
  }, [ids, reloadKey])

  if (members.length === 0) return null

  return (
    <section className="card team-overview">
      <h2>Meine Mitarbeiter</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Jetzt</th>
              <th>Heute</th>
              <th>Diese Woche</th>
              <th>Überstunden</th>
              <th>Offene Anträge</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const r = rows[m.id]
              return (
                <tr key={m.id} className={m.id === selected ? 'selected' : ''} onClick={() => onPick(m.id)}>
                  <td>
                    <button className="link" onClick={() => onPick(m.id)}>{displayName(m)}</button>
                  </td>
                  <td>
                    {r?.running ? <span className="time-running">● seit {clockTime(r.running.started_at)}</span> : <span className="muted">–</span>}
                  </td>
                  <td>{r ? formatMinutes(r.today) : '…'}</td>
                  <td>{r ? formatMinutes(r.week) : '…'}</td>
                  <td className={r?.balance != null && r.balance < 0 ? 'overtime-minus' : 'overtime-plus'}>
                    {r?.balance != null ? signed(r.balance) : '…'}
                  </td>
                  <td>{r?.open ? <strong className="appointment-warn">{r.open}</strong> : <span className="muted">–</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">Auf einen Namen tippen, um die Zeiterfassung dieser Person unten anzuzeigen.</p>
    </section>
  )
}
