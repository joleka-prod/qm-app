import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { JobCard } from '../components/JobCard'
import { supabase } from '../lib/supabase'
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

function byTime(a: Ticket, b: Ticket) {
  return (a.montage_time ?? '99').localeCompare(b.montage_time ?? '99') || a.id - b.id
}

// Gesamtkalender für QM/Admin und Teamleiter: alle Monteure, eine Woche, Einplanen per Ziehen.
export function PlanningCalendar() {
  const { installers, byId } = useProfiles()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [planned, setPlanned] = useState<Ticket[]>([])
  const [unplanned, setUnplanned] = useState<Ticket[]>([])
  const [error, setError] = useState('')
  const [dropTarget, setDropTarget] = useState('')
  const [areaFilter, setAreaFilter] = useState<ServiceArea | ''>('')

  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => isoDate(addDays(weekStart, i))), [weekStart])
  const today = isoDate(new Date())

  const load = useCallback(async () => {
    const [p, u] = await Promise.all([
      supabase
        .from('tickets')
        .select('*')
        .neq('ticket_type', 'qm')
        .gte('montage_date', isoDate(weekStart))
        .lte('montage_date', isoDate(addDays(weekStart, DAYS - 1))),
      supabase.from('tickets').select('*').neq('ticket_type', 'qm').eq('status', 'neu').order('created_at'),
    ])
    setPlanned(((p.data ?? []) as Ticket[]).filter((t) => t.installer_id))
    setUnplanned((u.data ?? []) as Ticket[])
  }, [weekStart])

  useEffect(() => {
    load()
  }, [load])

  async function plan(ticketId: number, installerId: string | null, date: string | null) {
    setError('')
    const { error } = await supabase
      .from('tickets')
      .update({ installer_id: installerId, montage_date: date })
      .eq('id', ticketId)
    if (error) setError(error.message)
    load()
  }

  function dropProps(key: string, installerId: string | null, date: string | null) {
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
        if (id) plan(id, installerId, date)
      },
    }
  }

  const cell = (installerId: string, date: string) =>
    planned
      .filter((t) => t.installer_id === installerId && t.montage_date === date)
      .filter((t) => !areaFilter || t.service_area === areaFilter)
      .sort(byTime)

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

      <div className="cal-scroll">
        <table className="cal">
          <thead>
            <tr>
              <th className="cal-corner">Monteur</th>
              {days.map((d) => (
                <th key={d} className={d === today ? 'cal-today' : ''}>
                  {new Date(d + 'T00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {installers.map((m) => (
              <tr key={m.id}>
                <th className="cal-name">
                  <Link to={`/monteur/${m.id}`}>{displayName(m)}</Link>
                </th>
                {days.map((d) => {
                  const key = `${m.id}|${d}`
                  return (
                    <td
                      key={d}
                      className={`${d === today ? 'cal-today' : ''} ${dropTarget === key ? 'cal-drop' : ''}`}
                      {...dropProps(key, m.id, d)}
                    >
                      {cell(m.id, d).map((t) => (
                        <JobCard key={t.id} ticket={t} draggable={t.status !== 'abgeschlossen'} />
                      ))}
                      <Link
                        className="cal-add"
                        to={`/neu?art=${areaFilter === 'kundendienst' ? 'reparatur' : 'restarbeit'}&monteur=${m.id}&datum=${d}${areaFilter ? `&bereich=${areaFilter}` : ''}`}
                        aria-label={`Neuer Einsatz für ${displayName(m)} am ${d}`}
                      >
                        +
                      </Link>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section
        className={`card unplanned ${dropTarget === 'unplanned' ? 'cal-drop' : ''}`}
        {...dropProps('unplanned', null, null)}
      >
        <h2>Ungeplant ({unplanned.length})</h2>
        <p className="muted small">
          Am PC: Einsatz in den Kalender ziehen. Am Handy: Einsatz öffnen und unter „Einsatzplanung“ Monteur und Datum wählen.
        </p>
        <div className="unplanned-list">
          {unplanned.filter((t) => !areaFilter || t.service_area === areaFilter).map((t) => (
            <div key={t.id}>
              <JobCard ticket={t} draggable />
              {t.installer_id && <div className="muted small">nur Monteur: {displayName(byId[t.installer_id])}</div>}
              {t.montage_date && !t.installer_id && <div className="muted small">nur Datum: {formatDay(t.montage_date)}</div>}
            </div>
          ))}
          {unplanned.length === 0 && <p className="muted">Alles eingeplant.</p>}
        </div>
      </section>
    </div>
  )
}
