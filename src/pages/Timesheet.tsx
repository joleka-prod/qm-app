import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { AttendanceApprovals, requestText, span, type AttendanceRequest } from '../components/AttendanceApprovals'
import { ClockBar } from '../components/ClockBar'
import { MonthPicker } from '../components/MonthPicker'
import { OvertimeCard } from '../components/OvertimeCard'
import { TeamOverview } from '../components/TeamOverview'
import { TimeChangeNotices } from '../components/TimeChangeNotices'
import { VacationBlocks } from '../components/VacationBlocks'
import { VacationCard, type VacationRequest } from '../components/VacationCard'
import { minutesOf, toLocalInput, type TimeEntry } from '../components/TimeCard'
import { clockTime, fixedBreakMinutes, fixedBreakSegments, formatMinutes, minutesBetween, useClockChanged, workMinutes, type Attendance } from '../lib/clock'
import { holidayName } from '../lib/holidays'
import { supabase } from '../lib/supabase'
import { canSeePersonnel, displayName, formatDate, formatDay, isoDate, parseDate, weekNumber } from '../lib/types'
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

type Edit = { id?: number; start: string; end: string; reason: string }

// Stundenkonto: Tage, Wochen und Monat aus den Stempelzeiten. Mitarbeiter sehen ihr eigenes,
// Vorgesetzte ihre Mitarbeiter, Personalabteilung und Admin alle; sie können Zeiten korrigieren oder nachtragen.
const VACATION_TEXT = {
  urlaub: 'Urlaub ', ueberstunden: 'Frei (Überstunden) ', krank: 'Krank ', sonderurlaub: 'Sonderurlaub ',
  schulung: 'Schulung ', schule: 'Schule ', unbezahlt: 'Unbezahlter Urlaub ', kindkrank: 'Kindkrank ',
}

const REQUEST_STATE = { beantragt: 'Beantragt', genehmigt: 'Genehmigt', abgelehnt: 'Abgelehnt', storniert: 'Zurückgezogen' }

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
  // Urlaubssperren und Betriebsferien pflegen Admin und Personalabteilung (Reiter Einstellungen, ?ansicht=einstellungen)
  const canBlocks = isAdmin || isHr
  const blocksView = canBlocks && params.get('ansicht') === 'einstellungen'
  const staffId = params.get('person') ?? ''
  const installerId = staffView ? staffId : profile?.id ?? ''
  // Unter Urlaub/Überstunden: Kalender (Tagesliste) oder Anträge (&bereich=antraege)
  const requestsView = params.get('bereich') === 'antraege'
  function switchArea(area: 'kalender' | 'antraege') {
    setEdit(null)
    setInfo('')
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (area === 'antraege') next.set('bereich', 'antraege')
        else next.delete('bereich')
        return next
      },
      { replace: true },
    )
  }
  function switchView(view: '' | 'mitarbeiter' | 'einstellungen') {
    setEdit(null)
    setInfo('')
    setParams(view ? { ansicht: view } : {}, { replace: true })
  }
  // Person in der Mitarbeiteransicht wählen und zu deren Zeiten springen
  function pick(id: string) {
    setEdit(null)
    setInfo('')
    setParams(id ? { ansicht: 'mitarbeiter', person: id } : { ansicht: 'mitarbeiter' })
    window.scrollTo({ top: 0 })
  }
  const [month, setMonth] = useState(today.slice(0, 7))
  const [openNotices, setOpenNotices] = useState<number | null>(null)
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
  // Alle Zeitnachträge/-korrekturen der Person für den Bereich Anträge
  const [allRequests, setAllRequests] = useState<AttendanceRequest[]>([])
  const [info, setInfo] = useState('')

  const range = useMemo(() => {
    const all = monthDays(month)
    return { all, from: new Date(`${all[0]}T00:00`).toISOString(), to: new Date(`${all.at(-1)}T23:59:59`).toISOString() }
  }, [month])

  const load = useCallback(async () => {
    if (!installerId) return
    const [att, te, vac, req, allReq] = await Promise.all([
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
      supabase.from('attendance_requests').select('*').eq('user_id', installerId).order('started_at', { ascending: false }).limit(500),
    ])
    setAllRequests((allReq.data ?? []) as AttendanceRequest[])
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


  // Monatsübersicht der gewählten Person (eigene Zeiten oder Mitarbeiter)
  const timesheet = installerId && (
    <>
      {info && <p className="info">{info}</p>}
      {profile && installerId && (
        <VacationCard
          userId={installerId}
          me={profile}
          byId={byId}
          year={Number(today.slice(0, 4))}
          onChanged={load}
          part="own"
          aside={<OvertimeCard userId={installerId} reloadKey={sessions} />}
          showRequests={requestsView}
          between={
            <nav className="emp-tabs" aria-label="Bereich">
              <button type="button" aria-pressed={!requestsView} className={requestsView ? '' : 'active'} onClick={() => switchArea('kalender')}>
                Kalender
              </button>
              <button type="button" aria-pressed={requestsView} className={requestsView ? 'active' : ''} onClick={() => switchArea('antraege')}>
                Anträge
              </button>
            </nav>
          }
        />
      )}

      {requestsView && (
        <section className="card">
          <div className="card-head">
            <h2>Zeitnachträge und Korrekturen</h2>
          </div>
          {allRequests.length === 0 ? (
            <p className="muted small">Keine Zeitnachträge. Fehlende oder falsche Zeiten trägst du im Kalender am jeweiligen Tag nach.</p>
          ) : (
            <div className="cal-scroll">
              <table className="import-table request-table">
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th>Zeit</th>
                    <th>Art</th>
                    <th>Status</th>
                    <th>Grund / Entscheidung</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {allRequests.map((r) => (
                    <tr key={r.id} className={r.state === 'storniert' || r.state === 'abgelehnt' ? 'muted' : ''}>
                      <td>{formatDay(isoDate(new Date(r.started_at)))}</td>
                      <td>
                        {span(r.started_at, r.ended_at)}
                        {r.old_started_at && <div className="small muted">vorher {span(r.old_started_at, r.old_ended_at)}</div>}
                      </td>
                      <td>{r.old_started_at ? 'Korrektur' : 'Nachtrag'}</td>
                      <td><span className={`badge badge-urlaub-${r.state}`}>{REQUEST_STATE[r.state]}</span></td>
                      <td className="small">
                        <div>{r.reason}</div>
                        {r.requested_by !== r.user_id && <div className="muted">eingetragen von {displayName(byId[r.requested_by])}</div>}
                        {r.decided_by && r.state !== 'beantragt' && (
                          <div className="muted">
                            {REQUEST_STATE[r.state]} von {displayName(byId[r.decided_by])}
                            {r.decided_at && <> am {formatDate(r.decided_at)}</>}
                            {r.decision_note && <> · {r.decision_note}</>}
                          </div>
                        )}
                      </td>
                      <td>
                        {r.state === 'beantragt' && (r.requested_by === profile?.id || r.user_id === profile?.id) && (
                          <button className="link" onClick={() => cancelRequest(r.id)}>Zurückziehen</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!requestsView && (
      <>

      <p className="muted small">
        Die Arbeitszeit kommt aus Start und Stopp der Zeiterfassung oben, abzüglich der festen Pausen 09:00–09:15 und 12:00–12:30. „Aufträge“ zeigt die Zeit, die auf
        Aufträge gebucht wurde.{canCorrect &&
          (changesDirectly
            ? ' Fehlende oder falsche Zeiten kannst du hier mit Grund nachtragen oder korrigieren; sie gelten sofort.'
            : ' Fehlende oder falsche Zeiten kannst du hier mit Grund nachtragen oder korrigieren; sie gelten nach Genehmigung durch den Vorgesetzten.')}
      </p>

      <div className="ts-month-nav">
        <MonthPicker month={month} onChange={setMonth} current={today.slice(0, 7)} />
      </div>

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
                          {s.note?.startsWith('TimeTac') && (
                            <span className="muted"> · {s.note.slice(7).trim() ? <><span className="ts-task">{s.note.slice(7).trim()}</span> (TimeTac)</> : 'Importiert aus TimeTac'}</span>
                          )}
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
                  ).flatMap((row, i) => {
                    // feste Pausen als eigene, automatisch gebuchte Zeile unter der Stempelzeit
                    const s = list[i]
                    if (edit?.id === s.id) return [row]
                    return [
                      row,
                      ...fixedBreakSegments(s.started_at, s.ended_at, now).map((b) => (
                        <div key={`${s.id}-p${b.from}`} className="ts-session ts-break small">
                          <span>
                            {clockTime(new Date(b.from).toISOString())} – {clockTime(new Date(b.to).toISOString())}
                            <span className="muted"> · <span className="ts-task">Pause</span> ({b.label}, automatisch gebucht)</span>
                          </span>
                        </div>
                      )),
                    ]
                  })}
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
      )}
    </>
  )

  // Offene Änderungsinfos zu den eigenen Zeiten müssen zuerst bestätigt werden;
  // bis dahin bleibt nur Start/Stopp nutzbar, damit keine Arbeitszeit verloren geht.
  const noticeGate = profile && <TimeChangeNotices userId={profile.id} byId={byId} reloadKey={sessions} onCount={setOpenNotices} />
  if (profile && openNotices !== 0) {
    return (
      <div>
        <ClockBar userId={profile.id} />
        {noticeGate}
      </div>
    )
  }

  return (
    <div>
      {profile && !staffView && !blocksView && <ClockBar userId={profile.id} />}
      {noticeGate}

      {/* Reiter wie im Bereich Personal */}
      {(hasStaffView || canBlocks) && (
        <nav className="emp-tabs" aria-label="Ansicht">
          <button type="button" aria-pressed={!staffView && !blocksView} className={staffView || blocksView ? '' : 'active'} onClick={() => switchView('')}>
            Meine Zeiten
          </button>
          {hasStaffView && (
            <button type="button" aria-pressed={staffView} className={staffView ? 'active' : ''} onClick={() => switchView('mitarbeiter')}>
              Mitarbeiter
            </button>
          )}
          {canBlocks && (
            <button type="button" aria-pressed={blocksView} className={`tab-end ${blocksView ? 'active' : ''}`} onClick={() => switchView('einstellungen')}>
              Einstellungen
            </button>
          )}
        </nav>
      )}

      {blocksView && <VacationBlocks byId={byId} />}

      {!staffView && !blocksView && timesheet}

      {staffView && profile && (
        <>
          {/* Person gewählt: nur deren Zeiterfassung, zurück zur Übersicht per Button */}
          {installerId ? (
            <div>
              {/* Kopf wie in der Personalakte: Name links, zurück rechts */}
              <div className="page-head wrap">
                <h1>{displayName(byId[installerId])}</h1>
                <button type="button" onClick={() => pick('')}>← Zurück zur Mitarbeiterübersicht</button>
              </div>
              {timesheet}
            </div>
          ) : (
            <>
              <AttendanceApprovals me={profile} byId={byId} onChanged={load} />
              <VacationCard userId={profile.id} me={profile} byId={byId} year={Number(today.slice(0, 4))} onChanged={load} part="approvals" />
              <TeamOverview
                members={others}
                selected={installerId}
                onPick={pick}
                reloadKey={sessions}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}
