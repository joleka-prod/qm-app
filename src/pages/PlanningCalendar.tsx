import { Fragment, useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { JobCard } from '../components/JobCard'
import { supabase } from '../lib/supabase'
import { loadMembers, useTeams, type Team, type TeamMember } from '../lib/teams'
import {
  AREA_LABEL,
  SERVICE_AREAS,
  addDays,
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

// Vorheriger Arbeitstag (Montag → Samstag)
function previousDay(d: string) {
  const prev = addDays(new Date(d + 'T00:00'), -1)
  return isoDate(prev.getDay() === 0 ? addDays(prev, -1) : prev)
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
  const [dropTarget, setDropTarget] = useState('')
  const [areaFilter, setAreaFilter] = useState<ServiceArea | ''>('')

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
      // Vortag des Montags für „wie Vortag“ mitladen
      loadMembers(previousDay(from), to),
    ])
    setPlanned(((p.data ?? []) as Ticket[]).filter((t) => t.team_id))
    setUnplanned((u.data ?? []) as Ticket[])
    setMembers(m)
  }, [weekStart])

  useEffect(() => {
    load()
  }, [load])

  async function plan(ticketId: number, team: Team | null, date: string | null) {
    setError('')
    const { error } = await supabase
      .from('tickets')
      .update({ team_id: team?.id ?? null, montage_date: date, ...(team ? { service_area: team.area } : {}) })
      .eq('id', ticketId)
    if (error) setError(error.message)
    load()
  }

  async function addMember(teamId: number, day: string, installerId: string) {
    setError('')
    const { error } = await supabase.from('team_members').insert({ team_id: teamId, day, installer_id: installerId })
    if (error) setError(error.message)
    load()
  }

  async function removeMember(m: TeamMember) {
    setError('')
    const { error } = await supabase.from('team_members').delete().match(m)
    if (error) setError(error.message)
    load()
  }

  // Besetzung des vorherigen Arbeitstags übernehmen, soweit Teams und Monteure an dem Tag noch frei sind
  async function copyPreviousDay(day: string) {
    setError('')
    const prev = previousDay(day)
    const taken = new Set(members.filter((m) => m.day === day).map((m) => m.installer_id))
    const filled = new Set(members.filter((m) => m.day === day).map((m) => m.team_id))
    const rows = members
      .filter((m) => m.day === prev && !taken.has(m.installer_id) && !filled.has(m.team_id))
      .filter((m) => installers.some((i) => i.id === m.installer_id))
      .map((m) => ({ team_id: m.team_id, day, installer_id: m.installer_id }))
    if (rows.length === 0) {
      setError(`Am ${formatDay(prev)} gibt es keine Besetzung, die übernommen werden kann.`)
      return
    }
    const { error } = await supabase.from('team_members').insert(rows)
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
  const membersIn = (teamId: number, date: string) => members.filter((m) => m.team_id === teamId && m.day === date)
  const freeInstallers = (date: string) => {
    const busy = new Set(members.filter((m) => m.day === date).map((m) => m.installer_id))
    return installers.filter((i) => !busy.has(i.id))
  }

  return (
    <div className="calendar-page">
      <div className="page-head">
        <h1>Kalender</h1>
        <div className="week-nav">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Vorige Woche">←</button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))}>KW {weekNumber(weekStart)}</button>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Nächste Woche">→</button>
        </div>
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
      {error && <p className="error">{error}</p>}
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
            Datum wählen.
          </p>
          <div className="unplanned-list">
            {unplanned.filter((t) => !areaFilter || t.service_area === areaFilter).map((t) => (
              <div key={t.id}>
                <JobCard ticket={t} draggable />
                {t.montage_date && !t.team_id && <div className="muted small">nur Datum: {formatDay(t.montage_date)}</div>}
              </div>
            ))}
            {unplanned.length === 0 && <p className="muted">Alles eingeplant.</p>}
          </div>
        </section>

        <div className="cal-scroll">
          <table className="cal">
            <thead>
              <tr>
                <th className="cal-corner">Team</th>
                {days.map((d) => (
                  <th key={d} className={d === today ? 'cal-today' : ''}>
                    {new Date(d + 'T00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                    <button
                      className="link small cal-copy"
                      title={`Besetzung vom ${formatDay(previousDay(d))} übernehmen`}
                      onClick={() => copyPreviousDay(d)}
                    >
                      wie Vortag
                    </button>
                  </th>
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
                    {days.map((d) => {
                      const key = `${team.id}|${d}`
                      const crew = membersIn(team.id, d)
                      const free = freeInstallers(d)
                      return (
                        <td
                          key={d}
                          className={`${d === today ? 'cal-today' : ''} ${dropTarget === key ? 'cal-drop' : ''}`}
                          {...dropProps(key, team, d)}
                        >
                          <div className="crew">
                            {crew.map((m) => (
                              <span key={m.installer_id} className="crew-chip">
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
                                onChange={(e) => e.target.value && addMember(team.id, d, e.target.value)}
                              >
                                <option value="">+ Monteur</option>
                                {free.map((p) => (
                                  <option key={p.id} value={p.id}>{displayName(p)}</option>
                                ))}
                              </select>
                            )}
                            {crew.length === 0 && jobsIn(team.id, d).length > 0 && (
                              <span className="crew-missing">Kein Monteur eingeteilt</span>
                            )}
                          </div>
                          {jobsIn(team.id, d).map((t) => (
                            <JobCard key={t.id} ticket={t} draggable={t.status !== 'abgeschlossen'} />
                          ))}
                          <Link
                            className="cal-add"
                            to={`/neu?art=${team.area === 'kundendienst' ? 'reparatur' : 'restarbeit'}&team=${team.id}&datum=${d}&bereich=${team.area}`}
                            aria-label={`Neuer Einsatz für ${team.name} am ${d}`}
                          >
                            +
                          </Link>
                        </td>
                      )
                    })}
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

      </div>

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
