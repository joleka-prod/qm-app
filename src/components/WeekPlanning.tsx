import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { supabase } from '../lib/supabase'
import { AREA_LABEL, SERVICE_AREAS, addDays, isoDate, startOfWeek, weekNumber, type ServiceArea, type Ticket } from '../lib/types'
import { JobCard } from './JobCard'
import { weekRange } from './WeekSelect'

const WEEKS = 6

// Kalender "Einplanung": ungeplante Aufträge grob einer Kalenderwoche vormerken.
// Taggenau eingeplant wird danach im Kalender Montage/Kundendienst.
export function WeekPlanning({ weekStart, areaFilter }: { weekStart: Date; areaFilter: ServiceArea | '' }) {
  const [open, setOpen] = useState<Ticket[]>([])
  const [scheduled, setScheduled] = useState<Pick<Ticket, 'id' | 'montage_date' | 'service_area'>[]>([])
  const [error, setError] = useState('')
  const [dropTarget, setDropTarget] = useState('')

  const weeks = useMemo(() => Array.from({ length: WEEKS }, (_, i) => isoDate(addDays(weekStart, i * 7))), [weekStart])
  const thisWeek = isoDate(startOfWeek(new Date()))

  const load = useCallback(async () => {
    const [o, s] = await Promise.all([
      supabase.from('tickets').select('*, ticket_positions(count)').neq('ticket_type', 'qm').eq('status', 'neu').order('created_at'),
      supabase
        .from('tickets')
        .select('id, montage_date, service_area')
        .neq('ticket_type', 'qm')
        .not('team_id', 'is', null)
        .gte('montage_date', weeks[0])
        .lt('montage_date', isoDate(addDays(new Date(weeks[WEEKS - 1] + 'T00:00'), 7))),
    ])
    setOpen((o.data ?? []) as Ticket[])
    setScheduled((s.data ?? []) as typeof scheduled)
  }, [weeks])

  useEffect(() => {
    load()
  }, [load])

  async function mark(ticketId: number, week: string | null, area: ServiceArea | null) {
    setError('')
    const { error } = await supabase
      .from('tickets')
      .update({ planned_week: week, ...(area ? { service_area: area } : {}) })
      .eq('id', ticketId)
    if (error) setError(error.message.includes('planned_week') ? 'Bitte zuerst das SQL-Update für die Einplanung ausführen.' : error.message)
    load()
  }

  function dropProps(key: string, week: string | null, area: ServiceArea | null) {
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
        if (id) mark(id, week, area)
      },
    }
  }

  const areas = SERVICE_AREAS.filter((a) => !areaFilter || a === areaFilter)
  const inArea = (t: Ticket) => !areaFilter || t.service_area === areaFilter
  const notMarked = open.filter((t) => !t.planned_week && inArea(t))
  const overdue = open.filter((t) => t.planned_week && t.planned_week < thisWeek && inArea(t))
  const jobsIn = (week: string, area: ServiceArea) => open.filter((t) => t.planned_week === week && t.service_area === area)
  const scheduledIn = (week: string, area: ServiceArea) => {
    const end = isoDate(addDays(new Date(week + 'T00:00'), 7))
    return scheduled.filter((t) => t.service_area === area && t.montage_date! >= week && t.montage_date! < end).length
  }

  return (
    <>
      {error && <p className="error">{error}</p>}
      <div className="calendar-layout">
        <section className={`card unplanned ${dropTarget === 'none' ? 'cal-drop' : ''}`} {...dropProps('none', null, null)}>
          <h2>Nicht vorgemerkt ({notMarked.length})</h2>
          <p className="muted small">
            Am PC: Auftrag auf eine Kalenderwoche ziehen. Am Handy: Auftrag öffnen und unter „Einsatzplanung“ die Woche wählen.
            Taggenau eingeplant wird danach unter „Montage & Kundendienst“.
          </p>
          {overdue.length > 0 && (
            <>
              <h3>Woche vorbei, noch nicht eingeplant</h3>
              <div className="unplanned-list">
                {overdue.map((t) => (
                  <div key={t.id}>
                    <JobCard ticket={t} draggable showWeek />
                  </div>
                ))}
              </div>
              <h3>Ohne Woche</h3>
            </>
          )}
          <div className="unplanned-list">
            {notMarked.map((t) => (
              <JobCard key={t.id} ticket={t} draggable />
            ))}
            {notMarked.length === 0 && <p className="muted">Alles vorgemerkt.</p>}
          </div>
        </section>

        {/* Handy: Wochen untereinander */}
        <div className="week-stack">
          {weeks.map((w) => (
            <section key={w} className={`card ${w === thisWeek ? 'highlight' : ''}`}>
              <h2>
                KW {weekNumber(new Date(w + 'T00:00'))} <span className="muted small">{weekRange(new Date(w + 'T00:00'))}</span>
              </h2>
              {areas.map((a) => {
                const jobs = jobsIn(w, a)
                const done = scheduledIn(w, a)
                return (
                  <div key={a} className="week-stack-area">
                    <h3>
                      {AREA_LABEL[a]}: {jobs.length} vorgemerkt{done > 0 && `, ${done} taggenau eingeplant`}
                    </h3>
                    {jobs.map((t) => (
                      <JobCard key={t.id} ticket={t} />
                    ))}
                  </div>
                )
              })}
            </section>
          ))}
        </div>

        <div className="cal-scroll week-table">
          <table className="cal cal-weeks">
            <thead>
              <tr>
                <th className="cal-corner">Bereich</th>
                {weeks.map((w) => (
                  <th key={w} className={w === thisWeek ? 'cal-today' : ''}>
                    KW {weekNumber(new Date(w + 'T00:00'))}
                    <span className="week-range">{weekRange(new Date(w + 'T00:00'))}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {areas.map((a) => (
                <tr key={a}>
                  <th className={`cal-name cal-team-${a}`}>{AREA_LABEL[a]}</th>
                  {weeks.map((w) => {
                    const key = `${a}|${w}`
                    const jobs = jobsIn(w, a)
                    const done = scheduledIn(w, a)
                    return (
                      <td key={key} className={`${w === thisWeek ? 'cal-today' : ''} ${dropTarget === key ? 'cal-drop' : ''}`} {...dropProps(key, w, a)}>
                        {jobs.length > 0 && <div className="week-count">{jobs.length} vorgemerkt</div>}
                        {jobs.map((t) => (
                          <JobCard key={t.id} ticket={t} draggable />
                        ))}
                        {done > 0 && <div className="week-count muted">{done} taggenau eingeplant</div>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
