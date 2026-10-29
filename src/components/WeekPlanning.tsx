import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { holidayName } from '../lib/holidays'
import { supabase } from '../lib/supabase'
import { AREA_LABEL, CALENDAR_SELECT, HOURS_PER_MAN_DAY, REFERENCE_HOURS_PER_WEEK, addDays, formatHours, manDays, isoDate, startOfWeek, weekNumber, type ServiceArea, type Ticket } from '../lib/types'
import { JobCard } from './JobCard'
import { weekRange } from './WeekSelect'

const WEEKS = 6

// Eine KW zählt zu dem Monat, in dem ihr Mittwoch liegt (also die meisten ihrer Werktage)
const monthOf = (week: string) => isoDate(addDays(new Date(week + 'T00:00'), 2)).slice(0, 7)

// alle Kalenderwochen (Montage) eines Monats ('2026-11')
function weeksOfMonth(month: string) {
  let w = startOfWeek(new Date(month + '-01T00:00'))
  if (monthOf(isoDate(w)) < month) w = addDays(w, 7)
  const list: string[] = []
  while (monthOf(isoDate(w)) === month) {
    list.push(isoDate(w))
    w = addDays(w, 7)
  }
  return list
}

// Kalender "Vorplanung" (Kapazitätsplanung, nur Auftragsart Montageauftrag): ungeplante Montageaufträge grob einer
// Kalenderwoche vormerken. Taggenau eingeplant wird danach im Kalender Montage & Kundendienst.
export function WeekPlanning({ weekStart }: { weekStart: Date }) {
  const [open, setOpen] = useState<Ticket[]>([])
  const [scheduled, setScheduled] = useState<Ticket[]>([])
  const [error, setError] = useState('')
  // verfügbare Manntage je Werktag (Monteure in der Montage abzüglich genehmigter Abwesenheit)
  const [capacity, setCapacity] = useState<{ day: string; installers: number; available: number }[] | null>(null)
  const [dropTarget, setDropTarget] = useState('')

  const weeks = useMemo(() => Array.from({ length: WEEKS }, (_, i) => isoDate(addDays(weekStart, i * 7))), [weekStart])
  const thisWeek = isoDate(startOfWeek(new Date()))
  // Monatsübersicht: ganze Monate der angezeigten Wochen, daher auch Wochen davor/danach laden
  const months = useMemo(() => [...new Set(weeks.map(monthOf))], [weeks])
  const monthWeeks = useMemo(() => Object.fromEntries(months.map((m) => [m, weeksOfMonth(m)])), [months])
  const from = monthWeeks[months[0]][0]
  const lastMonth = monthWeeks[months[months.length - 1]]
  const until = lastMonth[lastMonth.length - 1]

  const load = useCallback(async () => {
    const last = isoDate(addDays(new Date(until + 'T00:00'), 6))
    const [o, s, c] = await Promise.all([
      supabase.from('tickets').select(CALENDAR_SELECT).eq('ticket_type', 'montageauftrag').eq('status', 'neu').order('created_at'),
      supabase
        .from('tickets')
        .select(CALENDAR_SELECT)
        .eq('ticket_type', 'montageauftrag')
        .not('team_id', 'is', null)
        .gte('montage_date', from)
        .lte('montage_date', last),
      supabase.rpc('montage_capacity', { p_from: from, p_to: last }),
    ])
    setOpen((o.data ?? []) as Ticket[])
    // ohne SQL-Update gibt es die Funktion noch nicht: dann keine Kapazität anzeigen
    setCapacity(c.error ? null : (c.data as typeof capacity))
    setScheduled((s.data ?? []) as typeof scheduled)
  }, [from, until])

  useEffect(() => {
    load()
  }, [load])

  async function mark(ticketId: number, week: string | null) {
    setError('')
    const { error } = await supabase
      .from('tickets')
      .update({ planned_week: week })
      .eq('id', ticketId)
    if (error) setError(error.message.includes('planned_week') ? 'Bitte zuerst das SQL-Update für die Vorplanung ausführen.' : error.message)
    load()
  }

  function dropProps(key: string, week: string | null) {
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
        if (id) mark(id, week)
      },
    }
  }

  const areas: ServiceArea[] = ['montage']
  const inArea = (t: Ticket) => t.ticket_type === 'montageauftrag'
  const notMarked = open.filter((t) => !t.planned_week && inArea(t))
  const overdue = open.filter((t) => t.planned_week && t.planned_week < thisWeek && inArea(t))
  const jobsIn = (week: string, area: ServiceArea) => open.filter((t) => t.planned_week === week && !!area)
  const scheduledIn = (week: string, area: ServiceArea) => {
    const end = isoDate(addDays(new Date(week + 'T00:00'), 7))
    return scheduled.filter((t) => !!area && t.montage_date! >= week && t.montage_date! < end)
  }
  // Kapazität in Stunden: kalkulierte Manntage × 9 Std.
  const sumHours = (list: Ticket[]) => list.reduce((n, t) => n + (manDays(t.calc_men, Number(t.calc_days)) ?? 0), 0) * HOURS_PER_MAN_DAY
  const available = (week: string) => {
    const end = isoDate(addDays(new Date(week + 'T00:00'), 7))
    return (capacity ?? []).filter((c) => c.day >= week && c.day < end && !holidayName(c.day)).reduce((n, c) => n + c.available, 0) * HOURS_PER_MAN_DAY
  }
  const booked = (week: string) => sumHours([...jobsIn(week, 'montage'), ...scheduledIn(week, 'montage')])
  const hoursText = (list: Ticket[]) => (sumHours(list) > 0 ? ` · ${formatHours(sumHours(list))}` : '')
  const sum = (list: string[], f: (w: string) => number) => list.reduce((n, w) => n + f(w), 0)

  return (
    <>
      {error && <p className="error">{error}</p>}
      <section className="card month-overview">
        {months.map((m) => {
          const list = monthWeeks[m]
          const reference = list.length * REFERENCE_HOURS_PER_WEEK
          const b = sum(list, booked)
          const pct = Math.min(100, (b / reference) * 100)
          return (
            <div key={m} className={`month-capacity ${b > reference ? 'over' : ''}`}>
              <strong>{new Date(m + '-01T00:00').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</strong>
              <span>
                Verplant {formatHours(b)}
                {capacity && <> · verfügbar {formatHours(sum(list, available))}</>}
              </span>
              <span className="muted">
                Referenz {formatHours(reference)} ({list.length} KW × {formatHours(REFERENCE_HOURS_PER_WEEK)})
              </span>
              <span className="capacity-bar"><span style={{ width: `${pct}%` }} /></span>
            </div>
          )
        })}
      </section>
      <div className="calendar-layout">
        <section className={`card unplanned ${dropTarget === 'none' ? 'cal-drop' : ''}`} {...dropProps('none', null)}>
          <h2>Nicht vorgemerkt ({notMarked.length})</h2>
          <p className="muted small">
            Am PC: Auftrag auf eine Kalenderwoche ziehen. Am Handy: Auftrag öffnen und unter „Einsatzplanung“ die Woche wählen.
            Hier stehen nur Montageaufträge. Taggenau eingeplant wird danach unter „Montage & Kundendienst“.
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
              <Capacity booked={booked(w)} available={capacity ? available(w) : null} />
              {areas.map((a) => {
                const jobs = jobsIn(w, a)
                const done = scheduledIn(w, a)
                return (
                  <div key={a} className="week-stack-area">
                    <h3>
                      {AREA_LABEL[a]}: {jobs.length} vorgemerkt{hoursText(jobs)}
                      {done.length > 0 && `, ${done.length} taggenau eingeplant${hoursText(done)}`}
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
                    <Capacity booked={booked(w)} available={capacity ? available(w) : null} />
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
                      <td key={key} className={`${w === thisWeek ? 'cal-today' : ''} ${dropTarget === key ? 'cal-drop' : ''}`} {...dropProps(key, w)}>
                        {jobs.length > 0 && <div className="week-count">{jobs.length} vorgemerkt{hoursText(jobs)}</div>}
                        {jobs.map((t) => (
                          <JobCard key={t.id} ticket={t} draggable />
                        ))}
                        {done.length > 0 && <div className="week-count muted">{done.length} taggenau eingeplant{hoursText(done)}</div>}
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

// Auslastung einer Woche: verplante gegen verfügbare Stunden, dazu der feste Referenzwert
function Capacity({ booked, available }: { booked: number; available: number | null }) {
  const fmt = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 })
  const reference = <span className="week-reference">Referenz {formatHours(REFERENCE_HOURS_PER_WEEK)}</span>
  if (available === null)
    return (
      <>
        {booked > 0 && <span className="week-total">Gesamt {formatHours(booked)}</span>}
        {reference}
      </>
    )
  const over = booked > available
  const pct = available > 0 ? Math.min(100, (booked / available) * 100) : booked > 0 ? 100 : 0
  return (
    <>
      <span className={`capacity ${over ? 'over' : ''}`} title="Verplante Stunden (vorgemerkt und taggenau) von verfügbaren Stunden">
        <span className="capacity-text">
          {fmt(booked)} / {fmt(available)} Std.{over && ` · ${fmt(booked - available)} zu viel`}
        </span>
        <span className="capacity-bar"><span style={{ width: `${pct}%` }} /></span>
      </span>
      {reference}
    </>
  )
}
