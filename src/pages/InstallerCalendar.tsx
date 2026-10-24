import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { JobCard } from '../components/JobCard'
import { holidayName } from '../lib/holidays'
import { supabase } from '../lib/supabase'
import { loadMembers, useTeams, type TeamMember } from '../lib/teams'
import { addDays, displayName, formatDay, isoDate, startOfWeek, weekNumber, type Ticket } from '../lib/types'
import { useProfiles } from '../lib/useProfiles'

function byTime(a: Ticket, b: Ticket) {
  return (a.montage_time ?? '99').localeCompare(b.montage_time ?? '99') || a.id - b.id
}

// Persönlicher Kalender eines Monteurs: Tagesliste der Woche plus offene Einsätze aus Vorwochen.
// Ohne :id in der Adresse zeigt er den eigenen Kalender.
export function InstallerCalendar() {
  const { id } = useParams()
  const { profile } = useAuth()
  const { byId } = useProfiles()
  const installerId = id ?? profile?.id ?? ''
  const own = installerId === profile?.id

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [jobs, setJobs] = useState<Ticket[]>([])
  const [overdue, setOverdue] = useState<Ticket[]>([])
  const [members, setMembers] = useState<TeamMember[]>([])
  const { teamById } = useTeams()
  const today = isoDate(new Date())

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => isoDate(addDays(weekStart, i))), [weekStart])

  const load = useCallback(async () => {
    if (!installerId) return
    // Einsätze gehören zu Team + Tag; der Monteur sieht die Tage, an denen er im Team eingeteilt ist
    const since = isoDate(addDays(new Date(), -90))
    const [week, mine] = await Promise.all([loadMembers(days[0], days[6]), loadMembers(since, days[6], installerId)])
    const pairs = new Set(mine.map((m) => `${m.team_id}|${m.day}`))
    const teamIds = [...new Set(mine.map((m) => m.team_id))]
    const onMyTeam = (t: Ticket) => pairs.has(`${t.team_id}|${t.montage_date}`)
    if (teamIds.length === 0) {
      setJobs([])
      setOverdue([])
      setMembers(week)
      return
    }
    const [w, o] = await Promise.all([
      supabase
        .from('tickets')
        .select('*, ticket_positions(count)')
        .in('team_id', teamIds)
        .gte('montage_date', days[0])
        .lte('montage_date', days[6]),
      supabase
        .from('tickets')
        .select('*, ticket_positions(count)')
        .in('team_id', teamIds)
        .gte('montage_date', since)
        .lt('montage_date', today)
        .neq('status', 'abgeschlossen')
        .order('montage_date'),
    ])
    setJobs(((w.data ?? []) as Ticket[]).filter(onMyTeam))
    setOverdue(((o.data ?? []) as Ticket[]).filter(onMyTeam))
    setMembers(week)
  }, [installerId, days, today])

  useEffect(() => {
    load()
  }, [load])

  // Leere vergangene Tage und leere Wochenenden ausblenden
  const visibleDays = days.filter(
    (d, i) => jobs.some((j) => j.montage_date === d) || members.some((m) => m.day === d && m.installer_id === installerId) || (i < 5 && d >= today),
  )
  const crewOf = (d: string) => {
    const mine = members.find((m) => m.day === d && m.installer_id === installerId)
    if (!mine) return null
    const others = members.filter((m) => m.day === d && m.team_id === mine.team_id && m.installer_id !== installerId)
    const lead = members.find((m) => m.day === d && m.team_id === mine.team_id && m.lead)
    return {
      team: teamById[mine.team_id]?.name ?? 'Team',
      others: others.map((m) => displayName(byId[m.installer_id]) + (m.lead ? ' (verantwortlich)' : '')),
      isLead: lead?.installer_id === installerId,
    }
  }

  return (
    <div className="calendar-page">
      <div className="page-head">
        <h1>{own ? 'Mein Kalender' : `Kalender ${displayName(byId[installerId])}`}</h1>
        <div className="week-nav">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Vorige Woche">←</button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))}>KW {weekNumber(weekStart)}</button>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Nächste Woche">→</button>
        </div>
      </div>
      {!own && <Link to="/kalender" className="back">← Gesamtkalender</Link>}

      {overdue.length > 0 && (
        <section className="card danger-card">
          <h2>Noch offen aus den Vortagen ({overdue.length})</h2>
          <div className="agenda-jobs">
            {overdue.map((t) => (
              <div key={t.id}>
                <div className="muted small">{t.montage_date && formatDay(t.montage_date)}</div>
                <JobCard ticket={t} showAddress />
              </div>
            ))}
          </div>
        </section>
      )}

      {visibleDays.length === 0 && <p className="muted">Keine Einsätze in dieser Woche.</p>}

      {visibleDays.map((d) => {
        const list = jobs.filter((j) => j.montage_date === d).sort(byTime)
        return (
          <section key={d} className={`card agenda-day ${d === today ? 'agenda-today' : ''}`}>
            <h2>
              {formatDay(d)}
              {d === today && <span className="today-tag">Heute</span>}
              {holidayName(d) && <span className="holiday-name">{holidayName(d)}</span>}
            </h2>
            {crewOf(d) ? (
              <p className="crew-line">
                <strong>{crewOf(d)!.team}</strong>
                {crewOf(d)!.others.length > 0 && <> · mit {crewOf(d)!.others.join(', ')}</>}
                {crewOf(d)!.isLead && <span className="lead-tag">★ {own ? 'Du bist' : 'ist'} verantwortlich</span>}
              </p>
            ) : (
              <p className="muted small">Keinem Team zugeteilt.</p>
            )}
            {list.length === 0 ? (
              <p className="muted small">Keine Einsätze.</p>
            ) : (
              <div className="agenda-jobs">
                {list.map((t) => (
                  <JobCard key={t.id} ticket={t} showAddress />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
