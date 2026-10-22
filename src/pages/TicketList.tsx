import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { StatusBadge } from '../components/StatusBadge'
import { supabase } from '../lib/supabase'
import { STATUS_LABEL, displayName, formatDate, ticketNo, type Ticket, type TicketStatus } from '../lib/types'
import { useProfiles } from '../lib/useProfiles'

type Filter = 'offen' | 'meine' | 'alle' | TicketStatus

export function TicketList() {
  const { profile } = useAuth()
  const { byId } = useProfiles()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>(profile?.role === 'teamleiter' ? 'meine' : 'offen')
  const [query, setQuery] = useState('')

  useEffect(() => {
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
      if (filter === 'meine' && t.assigned_to !== profile?.id && t.created_by !== profile?.id) return false
      if (filter !== 'offen' && filter !== 'meine' && filter !== 'alle' && t.status !== filter) return false
      if (!q) return true
      return (
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        ticketNo(t.id).toLowerCase().includes(q)
      )
    })
  }, [tickets, filter, query, profile])

  return (
    <div>
      <div className="page-head">
        <h1>Tickets</h1>
        <Link to="/neu" className="button primary">+ Neues Ticket</Link>
      </div>
      <div className="filters">
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="offen">Alle offenen</option>
          <option value="meine">Meine</option>
          <option value="alle">Alle</option>
          {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
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
                  <span className="ticket-no">{ticketNo(t.id)}</span>
                  <StatusBadge status={t.status} />
                </div>
                <div className="ticket-title">{t.title}</div>
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
