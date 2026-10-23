import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { minutesOf, toLocalInput, type TimeEntry } from '../components/TimeCard'
import { clockTime, formatMinutes, minutesBetween, useClockChanged, type Attendance } from '../lib/clock'
import { supabase } from '../lib/supabase'
import { displayName, formatDay, isoDate, parseDate, weekNumber } from '../lib/types'
import { useProfiles } from '../lib/useProfiles'

// Gesetzliche Mindestpause (ArbZG): über 6 Std. 30 Min., über 9 Std. 45 Min.
function minBreak(work: number) {
  return work > 9 * 60 ? 45 : work > 6 * 60 ? 30 : 0
}

function monthDays(month: string) {
  const [y, m] = month.split('-').map(Number)
  const days: string[] = []
  for (let d = new Date(y, m - 1, 1); d.getMonth() === m - 1; d.setDate(d.getDate() + 1)) days.push(isoDate(d))
  return days
}

function shiftMonth(month: string, n: number) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

type Edit = { id?: number; start: string; end: string }

// Stundenkonto: Tage, Wochen und Monat aus den Stempelzeiten. Mitarbeiter sehen ihr eigenes,
// QM und Teamleiter alle und können Zeiten korrigieren oder nachtragen.
export function Timesheet() {
  const { profile } = useAuth()
  const { profiles, byId } = useProfiles()
  const staff = profiles.filter((p) => p.active)
  const isPlanner = profile?.role === 'admin' || profile?.role === 'teamleiter'
  const isAdmin = profile?.role === 'admin'
  const today = isoDate(new Date())

  const [installerId, setInstallerId] = useState(profile?.id ?? '')
  const [month, setMonth] = useState(today.slice(0, 7))
  const [sessions, setSessions] = useState<Attendance[]>([])
  const [jobs, setJobs] = useState<TimeEntry[]>([])
  const [edit, setEdit] = useState<Edit | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const now = Date.now()
  // Eigene Zeiten korrigiert nur der Admin
  const canCorrect = isAdmin || (isPlanner && installerId !== profile?.id)

  const range = useMemo(() => {
    const all = monthDays(month)
    return { all, from: new Date(`${all[0]}T00:00`).toISOString(), to: new Date(`${all.at(-1)}T23:59:59`).toISOString() }
  }, [month])

  const load = useCallback(async () => {
    if (!installerId) return
    const [att, te] = await Promise.all([
      supabase.from('attendance').select('*').eq('installer_id', installerId).gte('started_at', range.from).lte('started_at', range.to).order('started_at'),
      supabase.from('time_entries').select('*').eq('installer_id', installerId).gte('started_at', range.from).lte('started_at', range.to),
    ])
    setSessions((att.data ?? []) as Attendance[])
    setJobs((te.data ?? []) as TimeEntry[])
  }, [installerId, range])

  useEffect(() => {
    load()
  }, [load])
  useClockChanged(load)

  const byDay = useMemo(() => {
    const m: Record<string, Attendance[]> = {}
    for (const s of sessions) (m[isoDate(new Date(s.started_at))] ??= []).push(s)
    return m
  }, [sessions])
  const jobsByDay = useMemo(() => {
    const m: Record<string, number> = {}
    for (const e of jobs) {
      const d = isoDate(new Date(e.started_at))
      m[d] = (m[d] ?? 0) + minutesOf(e)
    }
    return m
  }, [jobs])

  const workOf = (day: string) => (byDay[day] ?? []).reduce((a, s) => a + minutesBetween(s.started_at, s.ended_at, now), 0)
  const breakOf = (day: string) => {
    const list = byDay[day] ?? []
    let gap = 0
    for (let i = 1; i < list.length; i++) {
      const prevEnd = list[i - 1].ended_at
      if (prevEnd) gap += minutesBetween(prevEnd, list[i].started_at)
    }
    return gap
  }

  async function saveEdit() {
    if (!edit) return
    setBusy(true)
    setError('')
    const row = { started_at: new Date(edit.start).toISOString(), ended_at: edit.end ? new Date(edit.end).toISOString() : null }
    const { error } = edit.id
      ? await supabase.from('attendance').update(row).eq('id', edit.id)
      : await supabase.from('attendance').insert({ ...row, installer_id: installerId })
    if (error) setError(/attendance_check|Ende/.test(error.message) ? 'Das Ende muss nach dem Beginn liegen.' : error.message)
    else setEdit(null)
    await load()
    setBusy(false)
  }

  async function remove(id: number) {
    if (!confirm('Diese Stempelzeit löschen?')) return
    setBusy(true)
    const { error } = await supabase.from('attendance').delete().eq('id', id)
    if (error) setError(error.message)
    setEdit(null)
    await load()
    setBusy(false)
  }

  const weeks: { kw: number; days: string[] }[] = []
  for (const d of range.all) {
    const kw = weekNumber(parseDate(d))
    if (weeks.at(-1)?.kw !== kw) weeks.push({ kw, days: [] })
    weeks.at(-1)!.days.push(d)
  }
  const sum = (list: string[], f: (d: string) => number) => list.reduce((a, d) => a + f(d), 0)
  const monthName = parseDate(`${month}-01`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })

  const editor = edit && (
    <div className="form time-edit">
      <div className="row">
        <label>
          Beginn
          <input type="datetime-local" value={edit.start} onChange={(e) => setEdit({ ...edit, start: e.target.value })} />
        </label>
        <label>
          Ende
          <input type="datetime-local" value={edit.end} onChange={(e) => setEdit({ ...edit, end: e.target.value })} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        {edit.id && isAdmin && (
          <button type="button" className="link danger" disabled={busy} onClick={() => remove(edit.id!)}>Löschen</button>
        )}
        <button disabled={busy} onClick={() => setEdit(null)}>Abbrechen</button>
        <button className="primary" disabled={busy || !edit.start} onClick={saveEdit}>Speichern</button>
      </div>
    </div>
  )

  return (
    <div>
      <div className="page-head">
        <h1>Stundenkonto</h1>
        <div className="week-nav">
          <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Voriger Monat">←</button>
          <button onClick={() => setMonth(today.slice(0, 7))}>{monthName}</button>
          <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Nächster Monat">→</button>
        </div>
      </div>

      {isPlanner && (
        <div className="filters">
          <select value={installerId} onChange={(e) => { setEdit(null); setInstallerId(e.target.value) }} aria-label="Mitarbeiter">
            {staff.map((p) => (
              <option key={p.id} value={p.id}>{displayName(p)}</option>
            ))}
          </select>
        </div>
      )}

      <p className="muted small">
        Die Arbeitszeit kommt aus der Zeiterfassung (Start/Stopp oben in der App). „Aufträge“ zeigt die Zeit, die auf
        Aufträge gebucht wurde.{canCorrect && ' Fehlende oder falsche Zeiten kannst du hier korrigieren oder nachtragen.'}
      </p>

      <div className="timesheet-days">
        {weeks.map((w) => (
          <div key={w.kw} className="card timesheet-week">
            {w.days.map((d) => {
              const list = byDay[d] ?? []
              const work = workOf(d)
              const pause = breakOf(d)
              const weekday = parseDate(d).getDay()
              if (list.length === 0 && !jobsByDay[d] && (weekday === 0 || weekday === 6 || d > today)) return null
              const short = work > 0 && pause < minBreak(work)
              return (
                <div key={d} className={`ts-day ${d === today ? 'today' : ''}`}>
                  <div className="ts-day-head">
                    <strong>{formatDay(d).replace(/\.\d{4}$/, '.')}</strong>
                    <span className="ts-work">{work > 0 ? formatMinutes(work) : <span className="muted">–</span>}</span>
                  </div>
                  {list.map((s) =>
                    edit?.id === s.id ? (
                      <div key={s.id}>{editor}</div>
                    ) : (
                      <div key={s.id} className="ts-session small">
                        <span>
                          {clockTime(s.started_at)} – {s.ended_at ? clockTime(s.ended_at) : <span className="time-running">läuft</span>}
                          {s.edited_by && <span className="muted"> · korrigiert von {displayName(byId[s.edited_by])}</span>}
                        </span>
                        {canCorrect && (
                          <button
                            className="link"
                            onClick={() => {
                              setError('')
                              setEdit({ id: s.id, start: toLocalInput(s.started_at), end: toLocalInput(s.ended_at) })
                            }}
                          >
                            Korrigieren
                          </button>
                        )}
                      </div>
                    ),
                  )}
                  <div className="ts-meta small muted">
                    {pause > 0 && <span>Pause {formatMinutes(pause)}</span>}
                    {!!jobsByDay[d] && <span>Aufträge {formatMinutes(jobsByDay[d])}</span>}
                    {short && <span className="appointment-warn">Pause unter {minBreak(work)} Min.</span>}
                    {canCorrect && !edit && d <= today && (
                      <button
                        className="link"
                        onClick={() => {
                          setError('')
                          setEdit({ start: `${d}T07:00`, end: `${d}T16:00` })
                        }}
                      >
                        + Zeit nachtragen
                      </button>
                    )}
                  </div>
                  {edit && !edit.id && edit.start.startsWith(d) && editor}
                </div>
              )
            })}
            <div className="ts-week-sum">
              <span>KW {w.kw}</span>
              <span>{formatMinutes(sum(w.days, workOf))}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="card ts-month-sum">
        <span>Summe {monthName}</span>
        <strong>{formatMinutes(sum(range.all, workOf))}</strong>
        <span className="muted small">davon auf Aufträge gebucht {formatMinutes(sum(range.all, (d) => jobsByDay[d] ?? 0))}</span>
      </div>
    </div>
  )
}
