import { Link } from 'react-router-dom'
import { ROLE_LABEL, projectAddress, type Project, type ProjectRole } from '../lib/projects'

export interface CustomerProject {
  role: ProjectRole
  projects: Project & {
    project_customers: { role: ProjectRole; customer_id: number; customers: { id: number; name: string; customer_number: string } | null }[]
    tickets: { count: number }[]
  }
}

// Kundenakte: Bauvorhaben, an denen der Kunde beteiligt ist, mit den übrigen Beteiligten
export function CustomerProjectsCard({ customerId, rows }: { customerId: number; rows: CustomerProject[] }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Bauvorhaben ({rows.length})</h2>
        <Link className="button" to={`/bauvorhaben/neu?kunde=${customerId}`}>+ Bauvorhaben</Link>
      </div>
      {rows.length === 0 ? (
        <p className="muted">Noch keinem Bauvorhaben zugeordnet.</p>
      ) : (
        <ul className="history stacked">
          {rows.map(({ role, projects: p }) => {
            const others = p.project_customers.filter((x) => x.customer_id !== customerId && x.customers)
            return (
              <li key={`${p.id}-${role}`} className={p.status === 'abgeschlossen' ? 'inactive' : ''}>
                <div>
                  <Link to={`/bauvorhaben/${p.id}`}>
                    {p.project_number} {p.name}
                  </Link>
                  <span className="muted small"> · als {ROLE_LABEL[role]}</span>
                  {p.status === 'abgeschlossen' && <span className="muted small"> · abgeschlossen</span>}
                </div>
                {projectAddress(p) && <div className="small">{projectAddress(p)}</div>}
                <div className="small muted">
                  {[
                    ...others.map((x) => `${x.customers!.name} (${ROLE_LABEL[x.role]})`),
                    `${p.tickets[0]?.count ?? 0} ${p.tickets[0]?.count === 1 ? 'Auftrag' : 'Aufträge'}`,
                  ].join(' · ')}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
