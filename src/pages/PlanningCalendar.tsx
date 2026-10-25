import { Fragment, useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { JobCard } from '../components/JobCard'
import { WeekPlanning } from '../components/WeekPlanning'
import { holidayName } from '../lib/holidays'
import { supabase } from '../lib/supabase'
import { loadMembers, useTeams, type Team, type TeamMember } from '../lib/teams'
import {
  AREA_LABEL,
  SERVICE_AREAS,
  addDays,
  appointmentMoveWarning,
  displayName,
  formatDay,
  isoDate,
  startOfWeek,
  weekNumber,
  type ServiceArea,
  type Ticket,
} from '../lib/types'
import { useProfiles } from '../lib/useProfiles'

const DAYS = 6 // Montag bis Samstag
const MAX_MEMBERS = 3

function byTime(a: Ticket, b: Ticket) {
  return (a.montage_time ?? '99').localeCompare(b.montage_time ?? '99') || a.id - b.id
}

// Gesamtkalender für QM/Admin und Teamleiter: Teams als Zeilen, pro Tag mit 1–3 Monteuren besetzt.
// Einsätze werden per Ziehen einem Team und Tag zugeordnet.
export function PlanningCalendar() {
  const { installers, byId } = useProfiles()
  const { teams } = useTeams()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [planned, setPlanned] = useState<Ticket[]>([])
  const [unplanned, setUnplanned] = useState<Ticket[]>([])
  const [members, setMembers] = useState<TeamMember[]>([])
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [dropTarget, setDropTarget] = useState('')
  const [areaFilter, setAreaFilter] = useState<ServiceArea | ''>('')
  // Ansicht gedreht: Teams als Spalten, Tage als Zeilen (Einstellung bleibt im Browser gespeichert)
  const [transposed, setTransposed] = useState(() => {
    try {
      return localStorage.getItem('cal-transposed') === '1'
    } catch {
      return false
    }
  })
  // Ansicht: taggenau (Montage & Kundendienst) oder Grobplanung nach Woche (Einplanung)
  const [view, setView] = useState<'tage' | 'einplanung'>(() => {
    try {
      return localStorage.getItem('cal-view') === 'einplanung' ? 'einplanung' : 'tage'
    } catch {
      return 'tage'
    }
  })
  function changeView(v: 'tage' | 'einplanung') {
    setView(v)
    try {
      localStorage.setItem('cal-view', v)
    } catch {
      /* egal */
    }
  }
  function toggleTransposed() {
    setTransposed((v) => {
      try {
        localStorage.setItem('cal-transposed', v ? '0' : '1')
      } catch {
        /* egal */
      }
      return !v
    })
  }

  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => isoDate(addDays(weekStart, i))), [weekStart])
  const today = isoDate(new Date())

  const load = useCallback(async () => {
    const from = isoDate(weekStart)
    const to = isoDate(addDays(weekStart, DAYS - 1))
    const [p, u, m] = await Promise.all([
      supabase
        .from('tickets')
        .select('*, ticket_positions(count)')
        .neq('ticket_type', 'qm')
        .gte('montage_date', from)
        .lte('montage_date', to),
      supabase.from('tickets').select('*, ticket_positions(count)').neq('ticket_type', 'qm').eq('status', 'neu').order('created_at'),
      loadMembers(from, to),
    ])
    setPlanned(((p.data ?? []) as Ticket[]).filter((t) => t.team_id))
    // vorgemerkte Wochen zuerst, danach nach Eingang
    setUnplanned(((u.data ?? []) as Ticket[]).sort((a, b) => (a.planned_week ?? '9').localeCompare(b.planned_week ?? '9')))
    setMembers(m)
  }, [weekStart])

  useEffect(() => {
    load()
  }, [load])

  async function plan(ticketId: number, team: Team | null, date: string | null) {
    setError('')
    if (team && date && !leadOf(team.id, date)) {
      setError(`Für ${team.name} ist am ${formatDay(date)} noch kein verantwortlicher Monteur eingeteilt.`)
      return
    }
    const t = planned.find((x) => x.id === ticketId)
    const warning =
      t && appointmentMoveWarning(t, date, date ? t.montage_time : null, t.appointment_told_by ? displayName(byId[t.appointment_told_by]) : undefined)
    if (warning && !confirm(warning)) return
    const { error } = await supabase
      .from('tickets')
      .update({ team_id: team?.id ?? null, montage_date: date, ...(team ? { service_area: team.area } : {}) })
      .eq('id', ticketId)
    if (error) setError(error.message)
    load()
  }

  async function addMember(team: Team, day: string, installerId: string) {
    setError('')
    setInfo('')
    const { error } = await supabase.from('team_members').insert({ team_id: team.id, day, installer_id: installerId })
    if (error) {
      setError(error.message)
      return load()
    }
    // Am Montag eingeteilt: auf Wunsch für die restliche Woche übernehmen
    const name = displayName(byId[installerId])
    if (new Date(day + 'T00:00').getDay() === 1 && confirm(`${name} auch von Dienstag bis Freitag in ${team.name} einplanen?`)) {
      const skipped: string[] = []
      for (let i = 1; i <= 4; i++) {
        const d = isoDate(addDays(new Date(day + 'T00:00'), i))
        const { error } = await supabase.from('team_members').insert({ team_id: team.id, day: d, installer_id: installerId })
        if (error) skipped.push(formatDay(d))
      }
      if (skipped.length) setInfo(`${name} konnte nicht eingeplant werden am ${skipped.join(', ')} (schon in einem anderen Team oder Team voll).`)
    }
    load()
  }

  async function makeLead(m: TeamMember) {
    setError('')
    const { error } = await supabase.rpc('set_team_lead', { p_team_id: m.team_id, p_day: m.day, p_installer_id: m.installer_id })
    if (error) setError(error.message)
    load()
  }

  async function removeMember(m: TeamMember) {
    setError('')
    const { error } = await supabase.from('team_members').delete().match(m)
    if (error) setError(error.message)
    load()
  }

  function dropProps(key: string, team: Team | null, date: string | null) {
    return {
      onDragOver: (e: DragEvent) => {
        e.preventDefault()
        setDropTarget(key)
      },
      onDragLeave: () => setDropTarget((k) => (k === key ? '' : k)),
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        setDropTarget('')
        const id = Number(e.dataTransfer.getData('text/ticket-id'))
        if (id) plan(id, team, date)
      },
    }
  }

  const visibleTeams = teams.filter((t) => !areaFilter || t.area === areaFilter)
  const jobsIn = (teamId: number, date: string) =>
    planned.filter((t) => t.team_id === teamId && t.montage_date === date).sort(byTime)
  const membersIn = (teamId: number, date: string) =>
    members.filter((m) => m.team_id === teamId && m.day === date).sort((a, b) => Number(b.lead) - Number(a.lead))
  const leadOf = (teamId: number, date: string) => members.find((m) => m.team_id === teamId && m.day === date && m.lead)
  const freeInstallers = (date: string) => {
    const busy = new Set(members.filter((m) => m.day === date).map((m) => m.installer_id))
    return installers.filter((i) => !busy.has(i.id))
  }

  // Eine Kalenderzelle: Besetzung und Einsätze eines Teams an einem Tag
  const cell = (team: Team, d: string) => {
    const key = `${team.id}|${d}`
    const crew = membersIn(team.id, d)
    const free = freeInstallers(d)
    return (
      <td
        key={key}
        className={`${d === today ? 'cal-today' : ''} ${holidayName(d) ? 'cal-holiday' : ''} ${dropTarget === key ? 'cal-drop' : ''}`}
        {...dropProps(key, team, d)}
      >
        <div className="crew">
          {crew.map((m) => (
            <span key={m.installer_id} className={`crew-chip ${m.lead ? 'crew-lead' : ''}`}>
              {m.lead ? (
                <span className="crew-star" title="Verantwortlich">★</span>
              ) : (
                <button
                  className="crew-star"
                  title="Als verantwortlich festlegen"
                  aria-label={`${displayName(byId[m.installer_id])} als verantwortlich festlegen`}
                  onClick={() => makeLead(m)}
                >
                  ☆
                </button>
              )}
              <Link to={`/monteur/${m.installer_id}`}>{displayName(byId[m.installer_id])}</Link>
              <button
                aria-label={`${displayName(byId[m.installer_id])} aus ${team.name} entfernen`}
                onClick={() => removeMember(m)}
              >
                ×
              </button>
            </span>
          ))}
          {crew.length < MAX_MEMBERS && free.length > 0 && (
            <select
              className="crew-add"
              aria-label={`Monteur zu ${team.name} am ${d} hinzufügen`}
              value=""
              onChange={(e) => e.target.value && addMember(team, d, e.target.value)}
            >
              <option value="">+ Monteur</option>
              {free.map((p) => (
                <option key={p.id} value={p.id}>{displayName(p)}</option>
              ))}
            </select>
          )}
          {crew.length === 0 && jobsIn(team.id, d).length > 0 && (
            <span className="crew-missing">Kein verantwortlicher Monteur</span>
          )}
        </div>
        {jobsIn(team.id, d).map((t) => (
          <JobCard key={t.id} ticket={t} draggable={t.status !== 'abgeschlossen'} />
        ))}
        {crew.length > 0 && (
          <Link
            className="cal-add"
            to={`/neu?art=${team.area === 'kundendienst' ? 'reparatur' : 'restarbeit'}&team=${team.id}&datum=${d}&bereich=${team.area}`}
            aria-label={`Neuer Einsatz für ${team.name} am ${d}`}
          >
            +
          </Link>
        )}
      </td>
    )
  }

  const dayLabel = (d: string) => (
    <>
      {new Date(d + 'T00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
      {holidayName(d) && <span className="holiday-name">{holidayName(d)}</span>}
    </>
  )
  // Teams einer Spalte nach Bereich gruppiert (für die Kopfzeile in der gedrehten Ansicht)
  const areaGroups = visibleTeams.reduce<{ area: ServiceArea; count: number }[]>((acc, t) => {
    const last = acc[acc.length - 1]
    if (last && last.area === t.area) last.count++
    else acc.push({ area: t.area, count: 1 })
    return acc
  }, [])

  return (
    <div className="calendar-page">
      <div className="page-head">
        <h1>{view === 'einplanung' ? 'Einplanung' : 'Kalender'}</h1>
        <div className="week-nav">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Vorige Woche">←</button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))}>KW {weekNumber(weekStart)}</button>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Nächste Woche">→</button>
          {view === 'tage' && (
            <button onClick={toggleTransposed} title="Zeilen und Spalten tauschen">
              {transposed ? '⇄ Teams als Zeilen' : '⇄ Teams oben'}
            </button>
          )}
        </div>
      </div>
      <div className="segmented two view-switch" role="radiogroup" aria-label="Kalender">
        <button role="radio" aria-checked={view === 'tage'} className={view === 'tage' ? 'active' : ''} onClick={() => changeView('tage')}>
          Montage &amp; Kundendienst
        </button>
        <button role="radio" aria-checked={view === 'einplanung'} className={view === 'einplanung' ? 'active' : ''} onClick={() => changeView('einplanung')}>
          Einplanung
        </button>
      </div>
      <div className="segmented three area-filter" role="radiogroup" aria-label="Bereich">
        {(['', ...SERVICE_AREAS] as const).map((a) => (
          <button
            key={a || 'alle'}
            role="radio"
            aria-checked={areaFilter === a}
            className={`${areaFilter === a ? 'active' : ''} ${a ? `area-btn-${a}` : ''}`}
            onClick={() => setAreaFilter(a)}
          >
            {a ? AREA_LABEL[a] : 'Alle'}
          </button>
        ))}
      </div>
      {view === 'einplanung' ? (
        <WeekPlanning weekStart={weekStart} areaFilter={areaFilter} />
      ) : (
        <>
          {error && <p className="error">{error}</p>}
          {info && <p className="info">{info}</p>}
          {installers.length === 0 && (
            <p className="info">
              Noch keine Monteure angelegt. Lege unter „Benutzer“ Personen mit der Rolle „Monteur“ an.
            </p>
          )}

          <div className="calendar-layout">
            <section
              className={`card unplanned ${dropTarget === 'unplanned' ? 'cal-drop' : ''}`}
              {...dropProps('unplanned', null, null)}
            >
              <h2>Ungeplant ({unplanned.length})</h2>
              <p className="muted small">
                Am PC: Einsatz auf ein Team und einen Tag ziehen. Am Handy: Einsatz öffnen und unter „Einsatzplanung“ Team und
                Datum wählen. Ein Team braucht dafür an dem Tag einen verantwortlichen Monteur (★).
              </p>
              <div className="unplanned-list">
                {unplanned.filter((t) => !areaFilter || t.service_area === areaFilter).map((t) => (
                  <div key={t.id}>
                    <JobCard ticket={t} draggable showWeek />
                    {t.montage_date && !t.team_id && <div className="muted small">nur Datum: {formatDay(t.montage_date)}</div>}
                  </div>
                ))}
                {unplanned.length === 0 && <p className="muted">Alles eingeplant.</p>}
              </div>
            </section>

            <div className="cal-scroll">
              {transposed ? (
                <table className="cal cal-transposed" style={{ minWidth: `${7.5 + visibleTeams.length * 10}rem` }}>
                  <thead>
                    {!areaFilter && (
                      <tr className="cal-group">
                        <th className="cal-corner" />
                        {areaGroups.map((g, i) => (
                          <th key={i} colSpan={g.count} className={`area-${g.area}`}>{AREA_LABEL[g.area]}</th>
                        ))}
                      </tr>
                    )}
                    <tr>
                      <th className="cal-corner">Tag</th>
                      {visibleTeams.map((team) => (
                        <th key={team.id} className={`cal-team-${team.area}`}>{team.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d) => (
                      <tr key={d}>
                        <th className={`cal-name ${d === today ? 'cal-today' : ''} ${holidayName(d) ? 'cal-holiday' : ''}`}>{dayLabel(d)}</th>
                        {visibleTeams.map((team) => cell(team, d))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="cal">
                  <thead>
                    <tr>
                      <th className="cal-corner">Team</th>
                      {days.map((d) => (
                        <th key={d} className={`${d === today ? 'cal-today' : ''} ${holidayName(d) ? 'cal-holiday' : ''}`}>{dayLabel(d)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTeams.map((team, i) => (
                      <Fragment key={team.id}>
                        {!areaFilter && (i === 0 || visibleTeams[i - 1].area !== team.area) && (
                          <tr className="cal-group">
                            <th colSpan={DAYS + 1} className={`area-${team.area}`}>{AREA_LABEL[team.area]}</th>
                          </tr>
                        )}
                        <tr>
                          <th className={`cal-name cal-team-${team.area}`}>{team.name}</th>
                          {days.map((d) => cell(team, d))}
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

          </div>
        </>
      )}

      {installers.length > 0 && (
        <section className="card">
          <h2>Kalender je Monteur</h2>
          <div className="installer-links">
            {installers.map((p) => (
              <Link key={p.id} to={`/monteur/${p.id}`}>{displayName(p)}</Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
