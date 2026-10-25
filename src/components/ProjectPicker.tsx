import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { projectAddress, projectLabel, searchProjects, type Project } from '../lib/projects'
import { supabase } from '../lib/supabase'

interface Props {
  value: Project | null
  onChange: (p: Project | null) => void
  // Bauvorhaben dieses Kunden werden zur schnellen Auswahl angeboten
  customerId: number | null
  // Neuer Auftrag: ohne Auswahl legt der Server das Bauvorhaben aus der Adresse an
  allowAuto?: boolean
}

// Auswahl des Bauvorhabens im Auftrag
export function ProjectPicker({ value, onChange, customerId, allowAuto }: Props) {
  const [own, setOwn] = useState<Project[]>([])
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Project[]>([])

  useEffect(() => {
    if (!customerId) return setOwn([])
    supabase
      .from('project_customers')
      .select('projects(*)')
      .eq('customer_id', customerId)
      .then(({ data }) =>
        setOwn(
          ((data ?? []) as unknown as { projects: Project | null }[])
            .map((r) => r.projects)
            .filter((p): p is Project => !!p && p.status === 'aktiv')
            .filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i),
        ),
      )
  }, [customerId])

  useEffect(() => {
    if (query.trim().length < 2) return setMatches([])
    let stale = false
    const t = setTimeout(async () => {
      const found = await searchProjects(query)
      if (!stale) setMatches(found)
    }, 250)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [query])

  function pick(p: Project | null) {
    onChange(p)
    setSearching(false)
    setQuery('')
  }

  return (
    <fieldset className="billing-address customer-box">
      <legend>Bauvorhaben</legend>
      {value && !searching ? (
        <div className="customer-summary">
          <div>
            <Link to={`/bauvorhaben/${value.id}`} className="customer-summary-name">{projectLabel(value)}</Link>
            {projectAddress(value) && <div className="small">{projectAddress(value)}</div>}
          </div>
          <div className="customer-summary-actions">
            <button type="button" className="link" onClick={() => setSearching(true)}>Ändern</button>
            {allowAuto && <button type="button" className="link" onClick={() => pick(null)}>Automatisch</button>}
          </div>
        </div>
      ) : (
        <>
          {allowAuto && !value && (
            <p className="small muted customer-link">
              Ohne Auswahl wird beim Speichern ein Bauvorhaben aus der Einsatzadresse angelegt (oder ein vorhandenes des Kunden an derselben Adresse genommen).
            </p>
          )}
          {own.length > 0 && (
            <div className="chip-row" aria-label="Bauvorhaben des Kunden">
              {own.map((p) => (
                <button type="button" key={p.id} className={value?.id === p.id ? 'chip active' : 'chip'} onClick={() => pick(p)}>
                  {projectLabel(p)}
                </button>
              ))}
            </div>
          )}
          <label>
            {own.length > 0 ? 'Anderes Bauvorhaben suchen' : 'Bauvorhaben suchen'}
            <input autoComplete="off" value={query} placeholder="Name, Nummer oder Ort" onChange={(e) => setQuery(e.target.value)} />
          </label>
          {matches.length > 0 && (
            <ul className="address-suggest" role="listbox" aria-label="Bauvorhaben">
              {matches.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => pick(p)}>
                    <strong>{p.project_number}</strong> {p.name}
                    <span className="muted small">
                      {projectAddress(p) && ` · ${projectAddress(p)}`}
                      {p.status === 'abgeschlossen' && ' · abgeschlossen'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {value && (
            <button type="button" className="link" onClick={() => setSearching(false)}>Abbrechen</button>
          )}
        </>
      )}
    </fieldset>
  )
}
