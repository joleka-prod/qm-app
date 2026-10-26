import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { STATUS, employeeName, type Employee } from '../lib/employee'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/types'
import { useProfiles } from '../lib/useProfiles'
import { Users } from './Users'

const fmt = (d: unknown) => (d ? new Date(String(d) + 'T00:00').toLocaleDateString('de-DE') : '–')

// Menüpunkt Personal: Personalakten und (nur Admin) App-Benutzer mit Stempel-Terminals
export function Personnel() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const users = profile?.role === 'admin' && params.get('ansicht') === 'benutzer'
  return (
    <div>
      {profile?.role === 'admin' && (
        <nav className="emp-tabs">
          <button type="button" className={users ? '' : 'active'} onClick={() => setParams({})}>Mitarbeiter</button>
          <button type="button" className={users ? 'active' : ''} onClick={() => setParams({ ansicht: 'benutzer' })}>App-Benutzer &amp; Terminals</button>
        </nav>
      )}
      {users ? <Users /> : <EmployeeList />}
    </div>
  )
}

// Übersicht Personalakten (nur Admin und Benutzer mit Zugriff auf Personalakten)
function EmployeeList() {
  const { profile } = useAuth()
  const { byId } = useProfiles()
  const navigate = useNavigate()
  const [list, setList] = useState<Employee[]>([])
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string>('Aktiv')

  useEffect(() => {
    supabase
      .from('employees')
      .select('id, ninox_id, user_id, personnel_number, status, first_name, last_name, department, entry_date, wage_concept, extra, updated_at')
      .then(({ data, error }) => {
        if (error) setError(error.message.includes('employees') ? 'Bitte zuerst das SQL-Update für das Personal ausführen.' : error.message)
        setList((data ?? []) as Employee[])
      })
  }, [])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return list
      .filter((e) => !status || e.status === status)
      .filter((e) => !needle || [employeeName(e), e.personnel_number, e.department].some((s) => String(s ?? '').toLowerCase().includes(needle)))
      .sort((a, b) => String(a.last_name).localeCompare(String(b.last_name), 'de') || String(a.first_name).localeCompare(String(b.first_name), 'de'))
  }, [list, q, status])

  async function create() {
    const { data, error } = await supabase.from('employees').insert({ status: 'Aktiv' }).select('id').single()
    if (error) setError(error.message)
    else navigate(`/personal/${data.id}`)
  }

  return (
    <div>
      <div className="page-head">
        <h1>Personal</h1>
        <div className="card-head-actions">
          {profile?.role === 'admin' && <Link className="button" to="/personal/import">Aus Ninox importieren</Link>}
          <button className="primary" onClick={create}>+ Mitarbeiter</button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="filters">
        <input type="search" placeholder="Name, Personalnummer, Abteilung…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
          <option value="">Alle</option>
        </select>
      </div>
      <section className="card">
        <div className="cal-scroll">
          <table className="import-table">
            <thead>
              <tr><th>Nr.</th><th>Name</th><th>Status</th><th>Abteilung</th><th>Firmeneintritt</th><th>App-Benutzer</th></tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} className={e.status === 'Aktiv' ? '' : 'muted'}>
                  <td>{String(e.personnel_number || '–')}</td>
                  <td><Link to={`/personal/${e.id}`}>{e.last_name || e.first_name ? `${e.last_name}, ${e.first_name}` : employeeName(e)}</Link></td>
                  <td>{String(e.status)}</td>
                  <td>{String(e.department || '–')}</td>
                  <td>{fmt(e.entry_date)}</td>
                  <td>{e.user_id ? (byId[e.user_id] ? `${displayName(byId[e.user_id])} (${byId[e.user_id].email})` : 'ja') : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && <p className="muted">Keine Einträge.</p>}
      </section>
    </div>
  )
}
