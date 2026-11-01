import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ROLE_LABEL, projectAddress, type Project, type ProjectRole } from '../lib/projects'
import { supabase } from '../lib/supabase'

const LIMIT = 100

// eigene Aufträge + Aufträge aus 3E
const orderCount = (p: Row) => (p.tickets[0]?.count ?? 0) + (p.erp_orders ?? 0)

type Row = Project & {
  project_customers: { role: ProjectRole; customers: { name: string; customer_number: string } | null }[]
  tickets: { count: number }[]
  erp_orders?: number
}

// Bauvorhaben: Liste mit Suche und Status. Seit dem 3E-Abgleich über 18.000: Suche macht die Datenbank (RPC search_projects)
export function Projects() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'aktiv' | 'abgeschlossen' | ''>('aktiv')
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    let stale = false
    const t = setTimeout(async () => {
      setLoading(true)
      const { data, error } = await supabase.rpc('search_projects', { p_query: query.trim(), p_status: status, p_limit: LIMIT })
      if (stale) return
      setError(error ? `Suche fehlgeschlagen: ${error.message}` : '')
      const res = (data ?? {}) as { rows?: Row[]; total?: number }
      setRows(res.rows ?? [])
      setTotal(res.total ?? 0)
      setLoading(false)
    }, query ? 300 : 0)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [query, status])

  const visible = rows

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
      {error && <p className="error">{error}</p>}
      {loading ? (
        <p className="muted">Lädt…</p>
      ) : visible.length === 0 ? (
        <p className="muted">Keine Bauvorhaben gefunden.</p>
      ) : (
        <>
        {total > visible.length && <p className="small muted">{visible.length} von {total} Bauvorhaben angezeigt. Bitte Suche eingrenzen.</p>}
        <ul className="ticket-list">
          {visible.map((p) => (
            <li key={p.id}>
              <Link to={`/bauvorhaben/${p.id}`} className={`card ticket-row ${p.status === 'abgeschlossen' ? 'inactive' : ''}`}>
                <div className="ticket-row-top">
                  <span className="ticket-no">{p.project_number}</span>
                  <span className="small muted">
                    {orderCount(p)} {orderCount(p) === 1 ? 'Auftrag' : 'Aufträge'}
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
        </>
      )}
    </div>
  )
}
