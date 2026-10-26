import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL, displayName } from '../lib/types'
import { useProfiles } from '../lib/useProfiles'

interface Row {
  user_id: string
  personnel_number: string
  job_title: string
  entry_date: string | null
  exit_date: string | null
}

const fmt = (d: string | null) => (d ? new Date(d + 'T00:00').toLocaleDateString('de-DE') : '–')

// Übersicht Personalakten (nur Admin und Benutzer mit Zugriff auf Personalakten)
export function Personnel() {
  const { profiles } = useProfiles()
  const [files, setFiles] = useState<Record<string, Row>>({})
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [showLeft, setShowLeft] = useState(false)

  useEffect(() => {
    supabase
      .from('personnel_files')
      .select('user_id, personnel_number, job_title, entry_date, exit_date')
      .then(({ data, error }) => {
        if (error) setError(error.message.includes('personnel_files') ? 'Bitte zuerst das SQL-Update für die Personalakte ausführen.' : error.message)
        setFiles(Object.fromEntries(((data ?? []) as Row[]).map((r) => [r.user_id, r])))
      })
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return profiles
      .map((p) => ({ p, f: files[p.id] }))
      .filter(({ p, f }) => {
        const left = !p.active || (!!f?.exit_date && f.exit_date < today)
        if (left && !showLeft) return false
        if (!needle) return true
        return [displayName(p), p.email, f?.personnel_number, f?.job_title].some((s) => (s ?? '').toLowerCase().includes(needle))
      })
      .sort((a, b) => displayName(a.p).localeCompare(displayName(b.p), 'de'))
  }, [profiles, files, q, showLeft, today])

  return (
    <div>
      <div className="page-head">
        <h1>Personal</h1>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="filters">
        <input type="search" placeholder="Name, Personalnummer, Tätigkeit…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="checkbox-row">
          <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} />
          Ausgeschiedene und deaktivierte anzeigen
        </label>
      </div>
      <section className="card">
        <div className="cal-scroll">
          <table className="import-table personnel-table">
            <thead>
              <tr><th>Name</th><th>Personalnr.</th><th>Tätigkeit</th><th>Rolle in der App</th><th>Eintritt</th><th>Austritt</th></tr>
            </thead>
            <tbody>
              {list.map(({ p, f }) => (
                <tr key={p.id} className={p.active ? '' : 'muted'}>
                  <td><Link to={`/personal/${p.id}`}>{displayName(p)}</Link>{!f && <span className="muted small"> · keine Akte</span>}</td>
                  <td>{f?.personnel_number || '–'}</td>
                  <td>{f?.job_title || '–'}</td>
                  <td>{ROLE_LABEL[p.role]}</td>
                  <td>{fmt(f?.entry_date ?? null)}</td>
                  <td>{fmt(f?.exit_date ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.length === 0 && <p className="muted">Keine Einträge.</p>}
      </section>
    </div>
  )
}
