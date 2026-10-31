import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { AttendanceApprovals, requestText, type AttendanceRequest } from '../components/AttendanceApprovals'
import { ClockBar } from '../components/ClockBar'
import { OvertimeCard } from '../components/OvertimeCard'
import { TeamOverview } from '../components/TeamOverview'
import { TimeChangeNotices } from '../components/TimeChangeNotices'
import { VacationCard, type VacationRequest } from '../components/VacationCard'
import { minutesOf, toLocalInput, type TimeEntry } from '../components/TimeCard'
import { clockTime, fixedBreakMinutes, formatMinutes, minutesBetween, useClockChanged, workMinutes, type Attendance } from '../lib/clock'
import { holidayName } from '../lib/holidays'
import { supabase } from '../lib/supabase'
import { canSeePersonnel, displayName, formatDay, isoDate, parseDate, weekNumber } from '../lib/types'
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

type Edit = { id?: number; start: string; end: string; reason: string }

// Stundenkonto: Tage, Wochen und Monat aus den Stempelzeiten. Mitarbeiter sehen ihr eigenes,
// Vorgesetzte ihre Mitarbeiter, Personalabteilung und Admin alle; sie können Zeiten korrigieren oder nachtragen.
const VACATION_TEXT = {
  urlaub: 'Urlaub ', ueberstunden: 'Frei (Überstunden) ', krank: 'Krank ', sonderurlaub: 'Sonderurlaub ',
  schulung: 'Schulung ', schule: 'Schule ', unbezahlt: 'Unbezahlter Urlaub ', kindkrank: 'Kindkrank ',
}

export function Timesheet() {
  const { profile } = useAuth()
  const { profiles, byId } = useProfiles()
  const staff = profiles.filter((p) => p.active)
  const isAdmin = profile?.role === 'admin'
  // Personalabteilung sieht und ändert die Zeiten aller Mitarbeiter
  const isHr = canSeePersonnel(profile)
  const today = isoDate(new Date())
  // Vorgesetzte sehen die Zeiten ihrer Mitarbeiter (auch über mehrere Ebenen)
  const isAbove = (id: string) => {
    let up = byId[id]?.supervisor_id
    for (let i = 0; up && i < 10; i++, up = byId[up]?.supervisor_id) if (up === profile?.id) return true
    return false
  }
  const choices = isAdmin || isHr ? staff : staff.filter((p) => p.id === profile?.id || isAbove(p.id))
  const others = choices.filter((p) => p.id !== profile?.id)
  // Mitarbeiteransicht nur für Vorgesetzte, Personalabteilung und Admin (wer andere Personen sehen darf)
  const hasStaffView = others.length > 0 || isAdmin

  // Zwei Ansichten: "Meine Zeiten" und "Mitarbeiter" (?ansicht=mitarbeiter, Person über &person=)
  const [params, setParams] = useSearchParams()
  const staffView = hasStaffView && params.get('ansicht') === 'mitarbeiter'
  const staffId = params.get('person') ?? ''
  const installerId = staffView ? staffId : profile?.id ?? ''
  const staffTimes = useRef<HTMLDivElement>(null)
  function switchView(staff: boolean) {
    setEdit(null)
    setInfo('')
    setParams(staff ? { ansicht: 'mitarbeiter', ...(staffId ? { person: staffId } : {}) } : {}, { replace: true })
  }
  // Person in der Mitarbeiteransicht wählen und zu deren Zeiten springen
  function pick(id: string) {
    setEdit(null)
    setInfo('')
    setParams(id ? { ansicht: 'mitarbeiter', person: id } : { ansicht: 'mitarbeiter' }, { replace: true })
    if (id) setTimeout(() => staffTimes.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    else window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const [month, setMonth] = useState(today.slice(0, 7))
  const [sessions, setSessions] = useState<Attendance[]>([])
  const [jobs, setJobs] = useState<TimeEntry[]>([])
  const [vacation, setVacation] = useState<VacationRequest[]>([])
  const [edit, setEdit] = useState<Edit | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const now = Date.now()
  // Nachtragen/Korrigieren darf man für sich selbst (mit Genehmigung), Admin, Personalabteilung und Vorgesetzte auch für andere.
  // Vorgesetzte, Admin und Personalabteilung ändern fremde Zeiten sofort; Genehmigen bleibt beim Vorgesetzten oder Admin.
  const canCorrect = installerId === profile?.id || isAdmin || isHr || isAbove(installerId)
  const changesDirectly = installerId !== profile?.id && (isAdmin || isHr || isAbove(installerId))
  const [requests, setRequests] = useState<AttendanceRequest[]>([])
  const [info, setInfo] = useState('')

  const range = useMemo(() => {
    const all = monthDays(month)
    return { all, from: new Date(`${all[0]}T00:00`).toISOString(), to: new Date(`${all.at(-1)}T23:59:59`).toISOString() }
  }, [month])

  const load = useCallback(async () => {
    if (!installerId) return
    const [att, te, vac, req] = await Promise.all([
      supabase.from('attendance').select('*').eq('installer_id', installerId).gte('started_at', range.from).lte('started_at', range.to).order('started_at'),
      supabase.from('time_entries').select('*').eq('installer_id', installerId).gte('started_at', range.from).lte('started_at', range.to),
      supabase
        .from('vacation_requests')
        .select('*')
        .eq('user_id', installerId)
        .eq('state', 'genehmigt')
        .lte('start_date', range.all.at(-1)!)
        .gte('end_date', range.all[0]),
      supabase
        .from('attendance_requests')
        .select('*')
        .eq('user_id', installerId)
        .in('state', ['beantragt', 'abgelehnt'])
        .gte('started_at', range.from)
        .lte('started_at', range.to)
        .order('started_at'),
    ])
    setRequests((req.data ?? []) as AttendanceRequest[])
    setVacation((vac.data ?? []) as VacationRequest[])
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

  const workOf = (day: string) => (byDay[day] ?? []).reduce((a, s) => a + workMinutes(s.started_at, s.ended_at, now), 0)
  const breakOf = (day: string) => {
    const list = byDay[day] ?? []
    // feste Pausen (Frühstück, Mittag) plus Lücken zwischen den Stempelzeiten
    let gap = list.reduce((a, s) => a + fixedBreakMinutes(s.started_at, s.ended_at, now), 0)
    for (let i = 1; i < list.length; i++) {
      const prevEnd = list[i - 1].ended_at
      if (prevEnd) gap += minutesBetween(prevEnd, list[i].started_at)
    }
    return gap
  }

  async function saveEdit() {
    if (!edit) return
    if (!edit.end) return setError('Bitte auch das Ende eintragen.')
    if (edit.reason.trim().length < 3) return setError('Bitte einen Grund angeben.')
    setBusy(true)
    setError('')
    setInfo('')
    const { data, error } = await supabase.rpc('request_attendance_change', {
      p_user: installerId,
      p_attendance_id: edit.id ?? null,
      p_start: new Date(edit.start).toISOString(),
      p_end: new Date(edit.end).toISOString(),
      p_reason: edit.reason.trim(),
    })
    if (error) setError(error.message)
    else {
      setEdit(null)
      setInfo(data === 'genehmigt' ? 'Die Zeit wurde übernommen.' : 'Die Zeit wurde zur Genehmigung an den Vorgesetzten geschickt.')
    }
    await load()
    setBusy(false)
  }

  async function cancelRequest(id: number) {
    if (!confirm('Nachtrag zurückziehen?')) return
    const { error } = await supabase.rpc('cancel_attendance_change', { p_id: id })
    if (error) setError(error.message)
    load()
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
      <label>
        Grund *
        <input
          value={edit.reason}
          maxLength={300}
          onChange={(e) => setEdit({ ...edit, reason: e.target.value })}
          placeholder="z. B. Ausstempeln vergessen"
        />
      </label>
      {changesDirectly ? (
        <p className="small muted">Die Änderung gilt sofort. {displayName(byId[installerId])} bekommt dazu eine Info in der Zeiterfassung.</p>
      ) : (
        <p className="small muted">Die Änderung gilt erst, wenn der Vorgesetzte sie genehmigt hat.</p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        {edit.id && isAdmin && (
          <button type="button" className="link danger" disabled={busy} onClick={() => remove(edit.id!)}>Löschen</button>
        )}
        <button disabled={busy} onClick={() => setEdit(null)}>Abbrechen</button>
        <button className="primary" disabled={busy || !edit.start || !edit.end || edit.reason.trim().length < 3} onClick={saveEdit}>
          {changesDirectly ? 'Speichern' : 'Zur Genehmigung senden'}
        </button>
      </div>
    </div>
  )

  const monthNav = (
    <div className="week-nav">
      <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Voriger Monat">←</button>
      <button onClick={() => setMonth(today.slice(0, 7))}>{monthName}</button>
      <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Nächster Monat">→</button>
    </div>
  )

  // Monatsübersicht der gewählten Person (eigene Zeiten oder Mitarbeiter)
  const timesheet = installerId && (
    <>
      {info && <p className="info">{info}</p>}
      {byId[installerId]?.supervisor_id && (
        <p className="small">Vorgesetzte(r): {displayName(byId[byId[installerId].supervisor_id!])}</p>
      )}
      {profile && installerId && (
        <VacationCard
          userId={installerId}
          me={profile}
          byId={byId}
          year={Number(month.slice(0, 4))}
          onChanged={load}
          part="own"
          aside={<OvertimeCard userId={installerId} reloadKey={sessions} />}
          below={installerId === profile.id && <TimeChangeNotices userId={installerId} byId={byId} reloadKey={sessions} />}
        />
      )}

      <p className="muted small">
        Die Arbeitszeit kommt aus Start und Stopp der Zeiterfassung oben, abzüglich der festen Pausen 09:00–09:15 und 12:00–12:30. „Aufträge“ zeigt die Zeit, die auf
        Aufträge gebucht wurde.{canCorrect &&
          (changesDirectly
            ? ' Fehlende oder falsche Zeiten kannst du hier mit Grund nachtragen oder korrigieren; sie gelten sofort.'
            : ' Fehlende oder falsche Zeiten kannst du hier mit Grund nachtragen oder korrigieren; sie gelten nach Genehmigung durch den Vorgesetzten.')}
      </p>

      <div className="timesheet-days">
        {weeks.map((w) => (
          <div key={w.kw} className="card timesheet-week">
            {w.days.map((d) => {
              const list = byDay[d] ?? []
              const work = workOf(d)
              const pause = breakOf(d)
              const weekday = parseDate(d).getDay()
              const vac = weekday !== 0 && weekday !== 6 && !holidayName(d) ? vacation.find((v) => v.start_date <= d && v.end_date >= d) : undefined
              const onVacation = !!vac
              if (list.length === 0 && !jobsByDay[d] && !onVacation && !requests.some((r) => isoDate(new Date(r.started_at)) === d) && (weekday === 0 || weekday === 6 || d > today)) return null
              const short = work > 0 && pause < minBreak(work)
              return (
                <div key={d} className={`ts-day ${d === today ? 'today' : ''}`}>
                  <div className="ts-day-head">
                    <strong>
                      {formatDay(d).replace(/\.\d{4}$/, '.')}
                      {holidayName(d) && <span className="holiday-name">{holidayName(d)}</span>}
                    </strong>
                    <span className="ts-work">
                      {vac && <span className="ts-vacation">{VACATION_TEXT[vac.kind as keyof typeof VACATION_TEXT] ?? 'Urlaub '}</span>}
                      {work > 0 ? formatMinutes(work) : !onVacation && <span className="muted">–</span>}
                    </span>
                  </div>
                  {list.map((s) =>
                    edit?.id === s.id ? (
                      <div key={s.id}>{editor}</div>
                    ) : (
                      <div key={s.id} className="ts-session small">
                        <span>
                          {clockTime(s.started_at)} – {s.ended_at ? clockTime(s.ended_at) : <span className="time-running">läuft</span>}
                          {s.note?.startsWith('TimeTac') && <span className="muted"> · Importiert aus TimeTac</span>}
                          {s.edited_by && <span className="muted"> · korrigiert von {displayName(byId[s.edited_by])}</span>}
                        </span>
                        {canCorrect && (
                          <button
                            className="link"
                            onClick={() => {
                              setError('')
                              setEdit({ id: s.id, start: toLocalInput(s.started_at), end: toLocalInput(s.ended_at), reason: '' })
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
                          setEdit({ start: `${d}T07:00`, end: `${d}T16:00`, reason: '' })
                        }}
                      >
                        + Zeit nachtragen
                      </button>
                    )}
                  </div>
                  {requests
                    .filter((r) => isoDate(new Date(r.started_at)) === d)
                    .map((r) => (
                      <div key={`r${r.id}`} className={`ts-request small ${r.state}`}>
                        <span>
                          {r.state === 'beantragt' ? 'Zur Genehmigung: ' : 'Abgelehnt: '}
                          {requestText(r).replace(/^[^:]+: /, '')} · {r.reason}
                          {r.decision_note && <> · {r.decision_note}</>}
                        </span>
                        {r.state === 'beantragt' && (r.requested_by === profile?.id || r.user_id === profile?.id) && (
                          <button className="link" onClick={() => cancelRequest(r.id)}>Zurückziehen</button>
                        )}
                      </div>
                    ))}
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
    </>
  )

  return (
    <div>
      {profile && !staffView && <ClockBar userId={profile.id} />}

      <div className="page-head">
        <h1>Zeiterfassung</h1>
        {!staffView && monthNav}
      </div>

      {hasStaffView && (
        <div className="segmented two view-switch" role="radiogroup" aria-label="Ansicht">
          <button role="radio" aria-checked={!staffView} className={staffView ? '' : 'active'} onClick={() => switchView(false)}>
            Meine Zeiten
          </button>
          <button role="radio" aria-checked={staffView} className={staffView ? 'active' : ''} onClick={() => switchView(true)}>
            Mitarbeiter
          </button>
        </div>
      )}

      {!staffView && timesheet}

      {staffView && profile && (
        <>
          <AttendanceApprovals me={profile} byId={byId} onChanged={load} />
          <VacationCard userId={profile.id} me={profile} byId={byId} year={Number(month.slice(0, 4))} onChanged={load} part="approvals" />
          <TeamOverview
            members={others}
            selected={installerId}
            onPick={pick}
            reloadKey={sessions}
          />

          {installerId && (
            <div className="staff-section" ref={staffTimes}>
              <div className="page-head">
                <h2>Zeiterfassung von {displayName(byId[installerId])}</h2>
                {monthNav}
              </div>
              {timesheet}
            </div>
          )}
        </>
      )}
    </div>
  )
}
