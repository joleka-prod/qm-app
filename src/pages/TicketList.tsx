import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { StatusBadge, TypeBadge } from '../components/StatusBadge'
import { supabase } from '../lib/supabase'
import {
  STATUS_LABEL,
  TICKET_TYPES,
  TYPE_LABEL,
  displayName,
  formatDate,
  formatDay,
  formatTime,
  orderRef,
  ticketNo,
  type Ticket,
  type TicketStatus,
  type TicketType,
} from '../lib/types'
import { useProfiles } from '../lib/useProfiles'

type Filter = 'offen' | 'meine' | 'alle' | 'loeschung' | TicketStatus

export function TicketList() {
  const { profile } = useAuth()
  const { byId } = useProfiles()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [deletionIds, setDeletionIds] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState<Filter>(profile?.role === 'teamleiter' || profile?.role === 'monteur' ? 'meine' : 'offen')
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TicketType | ''>('')

  useEffect(() => {
    supabase
      .from('deletion_requests')
      .select('ticket_id')
      .then(({ data }) => setDeletionIds(new Set((data ?? []).map((d) => d.ticket_id as number))))
    supabase
      .from('tickets')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setTickets((data ?? []) as Ticket[])
        setLoading(false)
      })
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tickets.filter((t) => {
      if (filter === 'offen' && t.status === 'abgeschlossen') return false
      if (typeFilter && t.ticket_type !== typeFilter) return false
      if (filter === 'meine' && t.assigned_to !== profile?.id && t.installer_id !== profile?.id && t.created_by !== profile?.id) return false
      if (filter === 'loeschung' && !deletionIds.has(t.id)) return false
      if (filter !== 'offen' && filter !== 'meine' && filter !== 'alle' && filter !== 'loeschung' && t.status !== filter) return false
      if (!q) return true
      return (
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.order_number.toLowerCase().includes(q) ||
        t.position_number.toLowerCase().includes(q) ||
        t.customer_name.toLowerCase().includes(q) ||
        ticketNo(t.id, t.ticket_type).toLowerCase().includes(q)
      )
    })
  }, [tickets, filter, typeFilter, query, profile, deletionIds])

  return (
    <div>
      <div className="page-head">
        <h1>Tickets</h1>
        <Link to="/neu" className="button primary">+ Neu</Link>
      </div>
      <div className="filters">
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="offen">Alle offenen</option>
          <option value="meine">Meine</option>
          <option value="alle">Alle</option>
          <option value="loeschung">Löschung beantragt{deletionIds.size > 0 ? ` (${deletionIds.size})` : ''}</option>
          {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
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
        <p className="muted">Keine Tickets gefunden.</p>
      ) : (
        <ul className="ticket-list">
          {visible.map((t) => (
            <li key={t.id}>
              <Link to={`/ticket/${t.id}`} className="card ticket-row">
                <div className="ticket-row-top">
                  <span className="ticket-no">
                    {ticketNo(t.id, t.ticket_type)} <TypeBadge type={t.ticket_type} />
                  </span>
                  <span className="badges">
                    {deletionIds.has(t.id) && <span className="badge badge-loeschung">Löschung beantragt</span>}
                    <StatusBadge status={t.status} type={t.ticket_type} />
                  </span>
                </div>
                <div className="ticket-title">{t.title}</div>
                {(orderRef(t) || t.customer_name) && (
                  <div className="small">{[t.customer_name, orderRef(t)].filter(Boolean).join(' · ')}</div>
                )}
                {t.installer_id && t.montage_date && (
                  <div className="small plan-line">
                    {formatDay(t.montage_date)} {formatTime(t.montage_time)} · {displayName(byId[t.installer_id])}
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
  )
}
