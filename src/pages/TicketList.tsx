import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { AreaBadge, StatusBadge, TypeBadge } from '../components/StatusBadge'
import { minutesOf } from '../components/TimeCard'
import { formatMinutes } from '../lib/clock'
import { supabase } from '../lib/supabase'
import { useTeams } from '../lib/teams'
import {
  statusLabel,
  TICKET_TYPES,
  TYPE_LABEL,
  addDays,
  displayName,
  formatDate,
  formatDay,
  formatTime,
  isoDate,
  orderRef,
  projectPlace,
  ticketNo,
  type Ticket,
  type TicketStatus,
  type TicketType,
  isPlannerRole,
} from '../lib/types'
import { useProfiles } from '../lib/useProfiles'

type Filter = 'offen' | 'meine' | 'alle' | 'loeschung' | 'nicht_angemeldet' | 'termin_angemeldet' | 'termin_bestaetigt' | 'zur_berechnung' | TicketStatus

export function TicketList() {
  const { profile } = useAuth()
  const { byId } = useProfiles()
  const { teamById } = useTeams()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [deletionIds, setDeletionIds] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState<Filter>(profile?.role === 'monteur' ? 'meine' : 'offen')
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TicketType | ''>('')

  useEffect(() => {
    supabase
      .from('deletion_requests')
      .select('ticket_id')
      .then(({ data }) => setDeletionIds(new Set((data ?? []).map((d) => d.ticket_id as number))))
    supabase
      .from('tickets')
      .select('*, ticket_positions(count), time_entries(started_at, ended_at), ticket_costs(total), project:projects(project_number, name, zip, city)')
      .neq('ticket_type', 'qm')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setTickets((data ?? []) as Ticket[])
        setLoading(false)
      })
  }, [])

  const isPlanner = isPlannerRole(profile?.role)
  const urgent = useMemo(() => {
    const planned = tickets
      .filter((t) => t.ticket_type !== 'qm' && t.status === 'zugewiesen' && t.montage_date)
      .sort((a, b) => `${a.montage_date}${a.montage_time ?? ''}`.localeCompare(`${b.montage_date}${b.montage_time ?? ''}`))
    const today = isoDate(new Date())
    const limit = isoDate(addWorkdays(new Date(), URGENT_WORKDAYS))
    const near = (t: Ticket) => t.montage_date! >= today && t.montage_date! <= limit
    // Termin wurde dem Kunden mitgeteilt, danach aber verschoben: Kunde muss neu informiert werden
    const moved = planned.filter((t) => t.appointment_state === 'offen' && t.appointment_announced_at)
    // Noch nie angemeldet und der Termin steht in den nächsten Werktagen an
    const soon = planned.filter((t) => t.appointment_state === 'offen' && !t.appointment_announced_at && near(t))
    // Angemeldet, aber der Kunde hat noch nicht bestätigt
    const unconfirmed = planned.filter((t) => t.appointment_state === 'angemeldet' && near(t))
    return { moved, soon, unconfirmed, count: moved.length + soon.length + unconfirmed.length }
  }, [tickets])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tickets.filter((t) => {
      // Zur Berechnung zählt noch als offen
      if (filter === 'offen' && t.status === 'abgeschlossen' && t.billing_state !== 'zur_berechnung') return false
      if (filter === 'zur_berechnung' && t.billing_state !== 'zur_berechnung') return false
      if (typeFilter && t.ticket_type !== typeFilter) return false
      // Monteure sehen ohnehin nur die Einsätze ihrer Teams
      if (filter === 'meine' && profile?.role !== 'monteur' && t.assigned_to !== profile?.id && t.created_by !== profile?.id) return false
      if (filter === 'loeschung' && !deletionIds.has(t.id)) return false
      if (filter === 'nicht_angemeldet' && !(t.ticket_type !== 'qm' && t.status === 'zugewiesen' && t.appointment_state === 'offen')) return false
      if (filter === 'termin_angemeldet' && !(t.status === 'zugewiesen' && t.appointment_state === 'angemeldet')) return false
      if (filter === 'termin_bestaetigt' && !(t.status === 'zugewiesen' && t.appointment_state === 'bestaetigt')) return false
      if (
        !['offen', 'meine', 'alle', 'loeschung', 'nicht_angemeldet', 'termin_angemeldet', 'termin_bestaetigt', 'zur_berechnung'].includes(filter) &&
        t.status !== filter
      )
        return false
      if (!q) return true
      return (
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.order_number.toLowerCase().includes(q) ||
        t.position_number.toLowerCase().includes(q) ||
        t.customer_name.toLowerCase().includes(q) ||
        (t.customer_number ?? '').toLowerCase().includes(q) ||
        (t.project ? `${t.project.project_number} ${t.project.name}`.toLowerCase().includes(q) : false) ||
        ticketNo(t.id, t.ticket_type).toLowerCase().includes(q)
      )
    })
  }, [tickets, filter, typeFilter, query, profile, deletionIds])

  return (
    <div className={isPlanner ? 'home-layout' : ''}>
      {isPlanner && (
        <aside className={`card urgent-col ${urgent.count > 0 ? 'has-urgent' : ''}`}>
          <h2>Dringender Handlungsbedarf{urgent.count > 0 && ` (${urgent.count})`}</h2>
          {loading ? (
            <p className="muted small">Lädt…</p>
          ) : (
            <>
              <UrgentGroup
                title="Termin verschoben"
                hint="Der Termin wurde geändert, nachdem er dem Kunden mitgeteilt wurde. Bitte den Kunden informieren und neu anmelden."
                tickets={urgent.moved}
                teamName={(id) => teamById[id]?.name}
                showTold
              />
              <UrgentGroup
                title="Termin noch nicht angemeldet"
                hint={`Einsatz ist in den nächsten ${URGENT_WORKDAYS} Werktagen, der Kunde wurde noch nicht informiert.`}
                tickets={urgent.soon}
                teamName={(id) => teamById[id]?.name}
              />
              <UrgentGroup
                title="Termin noch nicht bestätigt"
                hint={`Einsatz ist in den nächsten ${URGENT_WORKDAYS} Werktagen, der Kunde hat den Termin noch nicht bestätigt.`}
                tickets={urgent.unconfirmed}
                teamName={(id) => teamById[id]?.name}
              />
            </>
          )}
        </aside>
      )}
      <div className="home-main">
      <div className="page-head">
        <h1>Aufträge</h1>
        <Link to="/neu" className="button primary">+ Neu</Link>
      </div>
      <div className="filters">
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="offen">Alle offenen</option>
          <option value="meine">Meine</option>
          <option value="alle">Alle</option>
          <option value="loeschung">Löschung beantragt{deletionIds.size > 0 ? ` (${deletionIds.size})` : ''}</option>
          {(['neu', 'zugewiesen', 'abgeschlossen'] as TicketStatus[]).map((s) => (
            <option key={s} value={s}>{statusLabel('restarbeit', s)}</option>
          ))}
          <option value="nicht_angemeldet">Geplant, Termin noch nicht angemeldet</option>
          <option value="termin_angemeldet">Termin bei Kunde angemeldet</option>
          <option value="termin_bestaetigt">Termin von Kunde bestätigt</option>
          <option value="zur_berechnung">Zur Berechnung</option>
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TicketType | '')} aria-label="Art">
          <option value="">Alle Arten</option>
          {TICKET_TYPES.map((t) => (
            <option key={t} value={t}>{TYPE_LABEL[t]}</option>
          ))}
        </select>
        <input type="search" placeholder="Suchen…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {loading ? (
        <p className="muted">Lädt…</p>
      ) : visible.length === 0 ? (
        <p className="muted">Keine Aufträge gefunden.</p>
      ) : (
        <ul className="ticket-list">
          {visible.map((t) => (
            <li key={t.id}>
              <Link to={`/ticket/${t.id}`} className="card ticket-row">
                <div className="ticket-row-top">
                  <span className="ticket-no">
                    {ticketNo(t.id, t.ticket_type)} <TypeBadge type={t.ticket_type} /> <AreaBadge area={t.service_area} />
                  </span>
                  <span className="badges">
                    {deletionIds.has(t.id) && <span className="badge badge-loeschung">Löschung beantragt</span>}
                    <StatusBadge status={t.status} type={t.ticket_type} appointment={t.appointment_state} billing={t.billing_state} />
                  </span>
                </div>
                <div className="ticket-title">{t.title}</div>
                {(orderRef(t) || t.customer_name) && (
                  <div className="small">{[t.customer_name, orderRef(t)].filter(Boolean).join(' · ')}</div>
                )}
                {t.project && (
                  <div className="small">
                    <span className="muted">Bauvorhaben: </span>
                    {[`${t.project.project_number} ${t.project.name}`.trim(), projectPlace(t)].filter(Boolean).join(' · ')}
                  </div>
                )}
                {!!t.ticket_positions?.[0]?.count && (
                  <div className="small muted">{t.ticket_positions[0].count} Position(en)</div>
                )}
                {!!t.time_entries?.length && (
                  <div className="small">
                    Arbeitszeit {formatMinutes(t.time_entries.reduce((a, e) => a + minutesOf(e), 0))}
                    {t.time_entries.some((e) => !e.ended_at) && <span className="time-running"> · läuft</span>}
                  </div>
                )}
                {t.team_id && t.montage_date && (
                  <div className="small plan-line">
                    {formatDay(t.montage_date)} {formatTime(t.montage_time)} · {teamById[t.team_id]?.name}
                  </div>
                )}
                {costOf(t) != null && (
                  <div className="small">
                    Selbstkosten <strong>{costOf(t)!.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</strong>
                  </div>
                )}
                <div className="muted small">
                  {formatDate(t.created_at)} · von {displayName(byId[t.created_by])}
                  {t.assigned_to && <> · Verantwortlich: {displayName(byId[t.assigned_to])}</>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  )
}

// Gespeicherte Selbstkosten (nur für Planer sichtbar); PostgREST liefert die 1:1-Verknüpfung als Objekt
function costOf(t: Ticket & { ticket_costs?: { total: number } | { total: number }[] | null }) {
  const c = Array.isArray(t.ticket_costs) ? t.ticket_costs[0] : t.ticket_costs
  return c ? Number(c.total) : null
}

// So viele Werktage vor dem Einsatz muss der Termin beim Kunden angemeldet sein
const URGENT_WORKDAYS = 3

function addWorkdays(d: Date, n: number) {
  let r = d
  while (n > 0) {
    r = addDays(r, 1)
    if (r.getDay() !== 0 && r.getDay() !== 6) n--
  }
  return r
}

function UrgentGroup({
  title,
  hint,
  tickets,
  teamName,
  showTold,
}: {
  title: string
  hint: string
  tickets: Ticket[]
  teamName: (id: number) => string | undefined
  showTold?: boolean
}) {
  if (tickets.length === 0)
    return (
      <div className="urgent-group urgent-empty">
        <h3>{title}</h3>
        <p className="small muted">Keine Aufträge.</p>
      </div>
    )
  return (
    <div className="urgent-group">
      <h3>{title} ({tickets.length})</h3>
      <p className="small">{hint}</p>
      <ul className="urgent-list">
        {tickets.map((t) => (
          <li key={t.id}>
            <Link to={`/ticket/${t.id}`} className="urgent-item">
              <span className="ticket-no">{ticketNo(t.id, t.ticket_type)} <TypeBadge type={t.ticket_type} /></span>
              <span className="ticket-title">{t.title}</span>
              {t.customer_name && <span className="small">{t.customer_name}</span>}
              <span className="small urgent-dates">
                {showTold && (
                  <>
                    Mitgeteilt: {t.appointment_date ? formatDay(t.appointment_date) : '–'} {formatTime(t.appointment_time)}
                    <br />
                  </>
                )}
                {showTold ? 'Neu: ' : 'Termin: '}
                {t.montage_date ? formatDay(t.montage_date) : '–'} {formatTime(t.montage_time)}
                {t.team_id && <> · {teamName(t.team_id)}</>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
