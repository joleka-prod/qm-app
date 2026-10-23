import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { JobCard } from '../components/JobCard'
import { supabase } from '../lib/supabase'
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
  const today = isoDate(new Date())

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => isoDate(addDays(weekStart, i))), [weekStart])

  const load = useCallback(async () => {
    if (!installerId) return
    const [w, o] = await Promise.all([
      supabase
        .from('tickets')
        .select('*')
        .eq('installer_id', installerId)
        .gte('montage_date', days[0])
        .lte('montage_date', days[6]),
      supabase
        .from('tickets')
        .select('*')
        .eq('installer_id', installerId)
        .lt('montage_date', today)
        .neq('status', 'abgeschlossen')
        .order('montage_date'),
    ])
    setJobs((w.data ?? []) as Ticket[])
    setOverdue((o.data ?? []) as Ticket[])
  }, [installerId, days, today])

  useEffect(() => {
    load()
  }, [load])

  // Leere vergangene Tage und leere Wochenenden ausblenden
  const visibleDays = days.filter((d, i) => jobs.some((j) => j.montage_date === d) || (i < 5 && d >= today))

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
            </h2>
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
