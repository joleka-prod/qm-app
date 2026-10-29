import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { holidayName } from '../lib/holidays'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth'
import { AREA_LABEL, CALENDAR_SELECT, DEFAULT_PLANNING_SETTINGS, addDays, formatHours, manDays, isoDate, startOfWeek, weekNumber, type PlanningSettings, type ServiceArea, type Ticket } from '../lib/types'
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
  const [settings, setSettings] = useState<PlanningSettings>(DEFAULT_PLANNING_SETTINGS)
  const { profile } = useAuth()

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
    const [o, s, c, st] = await Promise.all([
      supabase.from('tickets').select(CALENDAR_SELECT).eq('ticket_type', 'montageauftrag').eq('status', 'neu').order('created_at'),
      supabase
        .from('tickets')
        .select(CALENDAR_SELECT)
        .eq('ticket_type', 'montageauftrag')
        .not('team_id', 'is', null)
        .gte('montage_date', from)
        .lte('montage_date', last),
      supabase.rpc('montage_capacity', { p_from: from, p_to: last }),
      supabase.from('planning_settings').select('hours_per_man_day, reference_hours_per_week').maybeSingle(),
    ])
    setOpen((o.data ?? []) as Ticket[])
    // ohne SQL-Update gibt es die Funktion noch nicht: dann keine Kapazität anzeigen
    setCapacity(c.error ? null : (c.data as typeof capacity))
    setScheduled((s.data ?? []) as typeof scheduled)
    // ohne SQL-Update gibt es die Tabelle noch nicht: dann gelten die Standardwerte
    if (st.data) setSettings({ hours_per_man_day: Number(st.data.hours_per_man_day), reference_hours_per_week: Number(st.data.reference_hours_per_week) })
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
  // Kapazität in Stunden: kalkulierte Manntage × Stunden je Manntag (Einstellung)
  const sumHours = (list: Ticket[]) => list.reduce((n, t) => n + (manDays(t.calc_men, Number(t.calc_days)) ?? 0), 0) * settings.hours_per_man_day
  const available = (week: string) => {
    const end = isoDate(addDays(new Date(week + 'T00:00'), 7))
    return (capacity ?? []).filter((c) => c.day >= week && c.day < end && !holidayName(c.day)).reduce((n, c) => n + c.available, 0) * settings.hours_per_man_day
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
          const reference = list.length * settings.reference_hours_per_week
          const b = sum(list, booked)
          const pct = reference > 0 ? Math.min(100, (b / reference) * 100) : 0
          return (
            <div key={m} className={`month-capacity ${b > reference ? 'over' : ''}`}>
              <strong>{new Date(m + '-01T00:00').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</strong>
              <span>
                Verplant {formatHours(b)}
                {capacity && <> · verfügbar {formatHours(sum(list, available))}</>}
              </span>
              <span className="muted">
                Referenz {formatHours(reference)} ({list.length} KW × {formatHours(settings.reference_hours_per_week)})
              </span>
              <span className="capacity-bar"><span style={{ width: `${pct}%` }} /></span>
            </div>
          )
        })}
        <PlanningSettingsInfo settings={settings} isAdmin={profile?.role === 'admin'} onSaved={load} />
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
                    <JobCard ticket={t} draggable showWeek hoursPerManDay={settings.hours_per_man_day} />
                  </div>
                ))}
              </div>
              <h3>Ohne Woche</h3>
            </>
          )}
          <div className="unplanned-list">
            {notMarked.map((t) => (
              <JobCard key={t.id} ticket={t} draggable hoursPerManDay={settings.hours_per_man_day} />
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
              <Capacity booked={booked(w)} available={capacity ? available(w) : null} reference={settings.reference_hours_per_week} />
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
                      <JobCard key={t.id} ticket={t} hoursPerManDay={settings.hours_per_man_day} />
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
                    <Capacity booked={booked(w)} available={capacity ? available(w) : null} reference={settings.reference_hours_per_week} />
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
                          <JobCard key={t.id} ticket={t} draggable hoursPerManDay={settings.hours_per_man_day} />
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
function Capacity({ booked, available, reference: ref }: { booked: number; available: number | null; reference: number }) {
  const fmt = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 })
  const reference = <span className="week-reference">Referenz {formatHours(ref)}</span>
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

// Werte der Vorplanung anzeigen; der Admin kann sie hier ändern
function PlanningSettingsInfo({ settings, isAdmin, onSaved }: { settings: PlanningSettings; isAdmin: boolean; onSaved: () => void }) {
  const [edit, setEdit] = useState<{ hours: string; reference: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fmt = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 })
  const num = (v: string) => Number(v.replace(/\./g, '').replace(',', '.'))

  async function save() {
    if (!edit) return
    const hours = num(edit.hours)
    const reference = num(edit.reference)
    if (!(hours > 0 && hours <= 24)) return setError('Stunden je Manntag: Zahl zwischen 0 und 24 eingeben.')
    if (!(reference >= 0 && reference <= 100000)) return setError('Referenzwert: Zahl ab 0 eingeben.')
    setBusy(true)
    setError('')
    const { data, error } = await supabase
      .from('planning_settings')
      .update({ hours_per_man_day: hours, reference_hours_per_week: reference, updated_at: new Date().toISOString(), updated_by: (await supabase.auth.getUser()).data.user?.id })
      .eq('id', true)
      .select('id')
    setBusy(false)
    if (error) return setError(error.message.includes('planning_settings') ? 'Bitte zuerst das SQL-Update für die Vorplanungs-Einstellungen ausführen.' : error.message)
    if (!data?.length) return setError('Nicht gespeichert: Nur der Admin darf die Einstellungen ändern.')
    setEdit(null)
    onSaved()
  }

  if (!edit)
    return (
      <div className="planning-settings muted small">
        1 Manntag = {fmt(settings.hours_per_man_day)} Std. · Referenz {fmt(settings.reference_hours_per_week)} Std. je KW
        {isAdmin && (
          <>
            {' '}
            <button
              className="link"
              onClick={() => setEdit({ hours: fmt(settings.hours_per_man_day), reference: String(settings.reference_hours_per_week).replace('.', ',') })}
            >
              Ändern
            </button>
          </>
        )}
      </div>
    )
  return (
    <div className="planning-settings">
      <div className="row">
        <label>
          Stunden je Manntag
          <input inputMode="decimal" value={edit.hours} onChange={(e) => setEdit({ ...edit, hours: e.target.value })} />
        </label>
        <label>
          Referenzwert je KW (Std.)
          <input inputMode="decimal" value={edit.reference} onChange={(e) => setEdit({ ...edit, reference: e.target.value })} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="planning-settings-actions">
        <button className="primary" onClick={save} disabled={busy}>
          Speichern
        </button>
        <button onClick={() => setEdit(null)} disabled={busy}>
          Abbrechen
        </button>
      </div>
    </div>
  )
}
