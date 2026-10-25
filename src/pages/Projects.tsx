import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ROLE_LABEL, projectAddress, type Project, type ProjectRole } from '../lib/projects'
import { supabase } from '../lib/supabase'

type Row = Project & {
  project_customers: { role: ProjectRole; customers: { name: string; customer_number: string } | null }[]
  tickets: { count: number }[]
}

// Bauvorhaben: Liste mit Suche und Status
export function Projects() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'aktiv' | 'abgeschlossen' | ''>('aktiv')

  useEffect(() => {
    supabase
      .from('projects')
      .select('*, project_customers(role, customers(name, customer_number)), tickets(count)')
      .order('id', { ascending: false })
      .then(({ data }) => {
        setRows((data ?? []) as Row[])
        setLoading(false)
      })
  }, [])

  const q = query.trim().toLowerCase()
  const visible = rows.filter(
    (p) =>
      (!status || p.status === status) &&
      (!q ||
        [p.project_number, p.name, p.street, p.zip, p.city, ...p.project_customers.map((x) => `${x.customers?.name} ${x.customers?.customer_number}`)]
          .join(' ')
          .toLowerCase()
          .includes(q)),
  )

  return (
    <div>
      <div className="page-head">
        <h1>Bauvorhaben</h1>
        <Link className="button primary" to="/bauvorhaben/neu">+ Neues Bauvorhaben</Link>
      </div>
      <div className="filters">
        <input type="search" placeholder="Name, Nummer, Ort, Kunde…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status">
          <option value="aktiv">Aktiv</option>
          <option value="abgeschlossen">Abgeschlossen</option>
          <option value="">Alle</option>
        </select>
      </div>
      {loading ? (
        <p className="muted">Lädt…</p>
      ) : visible.length === 0 ? (
        <p className="muted">Keine Bauvorhaben gefunden.</p>
      ) : (
        <ul className="ticket-list">
          {visible.map((p) => (
            <li key={p.id}>
              <Link to={`/bauvorhaben/${p.id}`} className={`card ticket-row ${p.status === 'abgeschlossen' ? 'inactive' : ''}`}>
                <div className="ticket-row-top">
                  <span className="ticket-no">{p.project_number}</span>
                  <span className="small muted">
                    {p.tickets[0]?.count ?? 0} {p.tickets[0]?.count === 1 ? 'Auftrag' : 'Aufträge'}
                    {p.status === 'abgeschlossen' && ' · abgeschlossen'}
                  </span>
                </div>
                <div className="ticket-title">{p.name}</div>
                {projectAddress(p) && <div className="small">{projectAddress(p)}</div>}
                {p.project_customers.length > 0 && (
                  <div className="small muted">
                    {p.project_customers
                      .filter((x) => x.customers)
                      .map((x) => `${x.customers!.name} (${ROLE_LABEL[x.role]})`)
                      .join(' · ')}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
