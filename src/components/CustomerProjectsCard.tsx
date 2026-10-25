import { Link } from 'react-router-dom'
import { ROLE_LABEL, projectAddress, type Project, type ProjectRole } from '../lib/projects'
import { formatDay, ticketNo, type Ticket } from '../lib/types'
import { StatusBadge, TypeBadge } from './StatusBadge'

export interface CustomerProject {
  role: ProjectRole
  projects: Project & {
    project_customers: { role: ProjectRole; customer_id: number; customers: { id: number; name: string; customer_number: string } | null }[]
    tickets: { count: number }[]
  }
}

// Kundenakte: Bauvorhaben, an denen der Kunde beteiligt ist, mit den übrigen Beteiligten
// und darunter den Aufträgen dieses Kunden im jeweiligen Bauvorhaben
export function CustomerProjectsCard({ customerId, rows, tickets }: { customerId: number; rows: CustomerProject[]; tickets: Ticket[] }) {
  // ein Kunde kann in mehreren Rollen beteiligt sein: je Bauvorhaben nur einmal zeigen
  const projects = [...new Map(rows.map((r) => [r.projects.id, r.projects])).values()]
  const rolesOf = (id: number) => rows.filter((r) => r.projects.id === id).map((r) => ROLE_LABEL[r.role])
  const loose = tickets.filter((t) => !t.project_id || !projects.some((p) => p.id === t.project_id))

  return (
    <section className="card">
      <div className="card-head">
        <h2>Bauvorhaben &amp; Aufträge</h2>
        <div className="card-head-actions">
          <Link className="button" to={`/bauvorhaben/neu?kunde=${customerId}`}>+ Bauvorhaben</Link>
          <Link className="button" to={`/neu?kunde=${customerId}`}>+ Auftrag</Link>
        </div>
      </div>
      {projects.length === 0 && loose.length === 0 && <p className="muted">Noch keine Bauvorhaben und Aufträge.</p>}
      {projects.map((p) => {
        const others = p.project_customers.filter((x) => x.customer_id !== customerId && x.customers)
        const own = tickets.filter((t) => t.project_id === p.id)
        const total = p.tickets[0]?.count ?? 0
        return (
          <div key={p.id} className={`project-group ${p.status === 'abgeschlossen' ? 'inactive' : ''}`}>
            <div className="project-head">
              <div>
                <Link to={`/bauvorhaben/${p.id}`} className="project-title">
                  {p.project_number} {p.name}
                </Link>
                <span className="muted small"> · als {rolesOf(p.id).join(', ')}</span>
                {p.status === 'abgeschlossen' && <span className="muted small"> · abgeschlossen</span>}
              </div>
              <Link className="small" to={`/neu?bv=${p.id}&kunde=${customerId}`}>+ Auftrag</Link>
            </div>
            {(projectAddress(p) || others.length > 0) && (
              <div className="small muted">
                {[projectAddress(p), ...others.map((x) => `${x.customers!.name} (${ROLE_LABEL[x.role]})`)].filter(Boolean).join(' · ')}
              </div>
            )}
            <TicketRows tickets={own} />
            {total > own.length && (
              <div className="small muted project-more">
                <Link to={`/bauvorhaben/${p.id}`}>{total - own.length} weitere{total - own.length === 1 ? 'r' : ''} Auftrag{total - own.length === 1 ? '' : 'e'} anderer Beteiligter im Bauvorhaben</Link>
              </div>
            )}
          </div>
        )
      })}
      {loose.length > 0 && (
        <div className="project-group">
          <div className="project-head">
            <span className="project-title muted">Ohne Bauvorhaben</span>
          </div>
          <TicketRows tickets={loose} />
        </div>
      )}
    </section>
  )
}

function TicketRows({ tickets }: { tickets: Ticket[] }) {
  if (tickets.length === 0) return <p className="small muted project-empty">Keine eigenen Aufträge.</p>
  return (
    <ul className="project-tickets">
      {tickets.map((t) => (
        <li key={t.id}>
          <span className="customer-ticket">
            <Link to={`/ticket/${t.id}`}>{ticketNo(t.id, t.ticket_type)}</Link> <TypeBadge type={t.ticket_type} />{' '}
            <StatusBadge status={t.status} type={t.ticket_type} appointment={t.appointment_state} billing={t.billing_state} />
          </span>
          <span className="project-ticket-title">{t.title}</span>
          <span className="muted small">
            {t.montage_date ? `Termin ${formatDay(t.montage_date)}` : `Angelegt ${formatDay(t.created_at.slice(0, 10))}`}
          </span>
        </li>
      ))}
    </ul>
  )
}
