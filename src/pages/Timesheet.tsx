import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { formatMinutes, minutesOf, type TimeEntry } from '../components/TimeCard'
import { supabase } from '../lib/supabase'
import { displayName, formatDay, isoDate, parseDate, weekNumber } from '../lib/types'
import { useProfiles } from '../lib/useProfiles'

interface WorkDay {
  id: number
  installer_id: string
  day: string
  start_time: string
  end_time: string
  break_minutes: number
  note: string
  edited_by: string | null
}

type Form = { id?: number; day: string; start: string; end: string; breakMin: string; note: string }

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function netMinutes(d: Pick<WorkDay, 'start_time' | 'end_time' | 'break_minutes'>) {
  return Math.max(0, toMin(d.end_time) - toMin(d.start_time) - d.break_minutes)
}

// Gesetzliche Mindestpause (ArbZG): über 6 Std. 30 Min., über 9 Std. 45 Min.
function minBreak(gross: number) {
  return gross > 9 * 60 ? 45 : gross > 6 * 60 ? 30 : 0
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

const hhmm = (t: string) => t.slice(0, 5)

// Stundenzettel: Monteure tragen ihre Arbeitszeit pro Tag ein, Planer sehen und korrigieren alle
export function Timesheet() {
  const { profile } = useAuth()
  const { installers } = useProfiles()
  const isPlanner = profile?.role === 'admin' || profile?.role === 'teamleiter'
  const isAdmin = profile?.role === 'admin'
  const today = isoDate(new Date())

  const [installerId, setInstallerId] = useState(isPlanner ? '' : profile?.id ?? '')
  const [month, setMonth] = useState(today.slice(0, 7))
  const [days, setDays] = useState<WorkDay[]>([])
  const [jobs, setJobs] = useState<TimeEntry[]>([])
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isPlanner && !installerId && installers.length > 0) setInstallerId(installers[0].id)
  }, [isPlanner, installerId, installers])

  const range = useMemo(() => {
    const all = monthDays(month)
    return { from: all[0], to: all[all.length - 1], all }
  }, [month])

  const load = useCallback(async () => {
    if (!installerId) return
    const [wd, te] = await Promise.all([
      supabase.from('work_days').select('*').eq('installer_id', installerId).gte('day', range.from).lte('day', range.to).order('day'),
      supabase
        .from('time_entries')
        .select('*')
        .eq('installer_id', installerId)
        .gte('started_at', `${range.from}T00:00:00`)
        .lte('started_at', `${range.to}T23:59:59`),
    ])
    setDays((wd.data ?? []) as WorkDay[])
    setJobs((te.data ?? []) as TimeEntry[])
  }, [installerId, range])

  useEffect(() => {
    load()
  }, [load])

  const byDay = useMemo(() => Object.fromEntries(days.map((d) => [d.day, d])), [days])
  const jobsByDay = useMemo(() => {
    const m: Record<string, TimeEntry[]> = {}
    for (const e of jobs) (m[isoDate(new Date(e.started_at))] ??= []).push(e)
    return m
  }, [jobs])

  const canEditDay = (day: string) => isPlanner || (installerId === profile?.id && day >= isoDate(new Date(Date.now() - 14 * 864e5)))

  function openDay(day: string) {
    setError('')
    const d = byDay[day]
    setForm(
      d
        ? { id: d.id, day, start: hhmm(d.start_time), end: hhmm(d.end_time), breakMin: String(d.break_minutes), note: d.note }
        : { day, start: '07:00', end: '16:00', breakMin: '30', note: '' },
    )
  }

  function fromJobs() {
    if (!form) return
    const list = jobsByDay[form.day] ?? []
    if (list.length === 0) return setError('An diesem Tag gibt es keine Auftragszeiten.')
    const clock = (iso: string) => new Date(iso).toTimeString().slice(0, 5)
    const start = list.map((e) => e.started_at).sort()[0]
    const end = list.map((e) => e.ended_at ?? new Date().toISOString()).sort().at(-1)!
    setForm({ ...form, start: clock(start), end: clock(end) })
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    setBusy(true)
    setError('')
    const row = {
      day: form.day,
      start_time: form.start,
      end_time: form.end,
      break_minutes: Number(form.breakMin) || 0,
      note: form.note,
    }
    const { error } = form.id
      ? await supabase.from('work_days').update(row).eq('id', form.id)
      : await supabase.from('work_days').insert({ ...row, installer_id: installerId })
    if (error) setError(/work_days_check|end_time/.test(error.message) ? 'Das Ende muss nach dem Beginn liegen.' : error.message)
    else setForm(null)
    await load()
    setBusy(false)
  }

  async function remove(id: number) {
    if (!confirm('Diesen Tag löschen?')) return
    setBusy(true)
    const { error } = await supabase.from('work_days').delete().eq('id', id)
    if (error) setError(error.message)
    setForm(null)
    await load()
    setBusy(false)
  }

  // Wochen- und Monatssummen
  const weeks: { kw: number; days: string[] }[] = []
  for (const d of range.all) {
    const kw = weekNumber(parseDate(d))
    if (weeks.at(-1)?.kw !== kw) weeks.push({ kw, days: [] })
    weeks.at(-1)!.days.push(d)
  }
  const sumNet = (list: string[]) => list.reduce((s, d) => s + (byDay[d] ? netMinutes(byDay[d]) : 0), 0)
  const sumJobs = (list: string[]) => list.reduce((s, d) => s + (jobsByDay[d] ?? []).reduce((a, e) => a + minutesOf(e), 0), 0)

  const formGross = form ? toMin(form.end) - toMin(form.start) : 0
  const formMinBreak = minBreak(formGross)
  const monthName = parseDate(`${month}-01`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })

  return (
    <div>
      <div className="page-head">
        <h1>Stundenzettel</h1>
        <div className="week-nav">
          <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Voriger Monat">←</button>
          <button onClick={() => setMonth(today.slice(0, 7))}>{monthName}</button>
          <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Nächster Monat">→</button>
        </div>
      </div>

      {isPlanner && (
        <div className="filters">
          <select value={installerId} onChange={(e) => { setForm(null); setInstallerId(e.target.value) }} aria-label="Monteur">
            {installers.map((p) => (
              <option key={p.id} value={p.id}>{displayName(p)}</option>
            ))}
          </select>
        </div>
      )}

      {!isPlanner && !byDay[today] && !form && month === today.slice(0, 7) && (
        <button className="primary" onClick={() => openDay(today)}>Arbeitszeit für heute eintragen</button>
      )}

      {form && (
        <form className="card form" onSubmit={save}>
          <h2>{formatDay(form.day)}</h2>
          <div className="row">
            <label>
              Beginn
              <input type="time" required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
            </label>
            <label>
              Ende
              <input type="time" required value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
            </label>
            <label>
              Pause (Min.)
              <input type="number" min={0} max={600} step={5} value={form.breakMin} onChange={(e) => setForm({ ...form, breakMin: e.target.value })} />
            </label>
          </div>
          {formGross > 0 && Number(form.breakMin) < formMinBreak && (
            <p className="small appointment-warn">
              Hinweis: Bei mehr als {formMinBreak === 45 ? '9' : '6'} Stunden Arbeitszeit sind mindestens {formMinBreak} Minuten Pause vorgeschrieben.
            </p>
          )}
          <label>
            Notiz (optional)
            <input maxLength={300} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
          <p className="small muted">
            Arbeitszeit: {formGross > 0 ? formatMinutes(Math.max(0, formGross - (Number(form.breakMin) || 0))) : '–'}
            {(jobsByDay[form.day] ?? []).length > 0 && (
              <>
                {' · '}
                <button type="button" className="link" onClick={fromJobs}>Beginn und Ende aus Auftragszeiten übernehmen</button>
              </>
            )}
          </p>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            {form.id && isAdmin && (
              <button type="button" className="link danger" disabled={busy} onClick={() => remove(form.id!)}>Löschen</button>
            )}
            <button type="button" disabled={busy} onClick={() => setForm(null)}>Abbrechen</button>
            <button className="primary" disabled={busy}>{busy ? 'Speichert…' : 'Speichern'}</button>
          </div>
        </form>
      )}

      <div className="card timesheet">
        <table>
          <thead>
            <tr>
              <th>Tag</th>
              <th>Beginn–Ende</th>
              <th>Pause</th>
              <th>Arbeitszeit</th>
              <th title="Summe der Fahrt- und Arbeitszeiten in den Aufträgen">Aufträge</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <WeekRows
                key={w.kw}
                kw={w.kw}
                days={w.days}
                byDay={byDay}
                jobsByDay={jobsByDay}
                today={today}
                canEdit={canEditDay}
                onOpen={openDay}
                net={sumNet(w.days)}
                jobsSum={sumJobs(w.days)}
              />
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={3}>Summe {monthName}</th>
              <th>{formatMinutes(sumNet(range.all))}</th>
              <th>{formatMinutes(sumJobs(range.all))}</th>
            </tr>
          </tfoot>
        </table>
      </div>
      {!isPlanner && <p className="muted small">Einträge der letzten 14 Tage kannst du selbst ändern, ältere nur QM oder ein Teamleiter.</p>}
    </div>
  )
}

function WeekRows(props: {
  kw: number
  days: string[]
  byDay: Record<string, WorkDay>
  jobsByDay: Record<string, TimeEntry[]>
  today: string
  canEdit: (day: string) => boolean
  onOpen: (day: string) => void
  net: number
  jobsSum: number
}) {
  const { kw, days, byDay, jobsByDay, today, canEdit, onOpen, net, jobsSum } = props
  return (
    <>
      {days.map((d) => {
        const w = byDay[d]
        const jobMin = (jobsByDay[d] ?? []).reduce((a, e) => a + minutesOf(e), 0)
        const weekday = parseDate(d).getDay()
        const clickable = d <= today && canEdit(d)
        if (!w && jobMin === 0 && (weekday === 0 || weekday === 6)) return null
        return (
          <tr
            key={d}
            className={`${clickable ? 'clickable' : ''} ${d === today ? 'today' : ''}`}
            onClick={() => clickable && onOpen(d)}
          >
            <td>{formatDay(d).replace(/\.\d{4}$/, '.')}</td>
            <td>{w ? `${hhmm(w.start_time)}–${hhmm(w.end_time)}` : <span className="muted">{clickable ? '+ eintragen' : '–'}</span>}</td>
            <td>{w ? `${w.break_minutes} Min.` : ''}</td>
            <td>
              {w ? formatMinutes(netMinutes(w)) : ''}
              {w?.edited_by && <span className="muted small" title="von QM/Teamleiter korrigiert"> ✎</span>}
            </td>
            <td className="muted">{jobMin > 0 ? formatMinutes(jobMin) : ''}</td>
          </tr>
        )
      })}
      <tr className="week-sum">
        <td colSpan={3}>KW {kw}</td>
        <td>{formatMinutes(net)}</td>
        <td>{jobsSum > 0 ? formatMinutes(jobsSum) : ''}</td>
      </tr>
    </>
  )
}
