import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { FollowUpList } from '../components/FollowUpList'
import { CUSTOMER_GROUPS, GROUP_LABEL, GROUP_PLURAL, customerAddress, type Customer, type CustomerGroup } from '../lib/customers'
import { supabase } from '../lib/supabase'

const LIMIT = 100

type Row = Customer & { tickets: { count: number }[]; customer_notes: { count: number }[]; customer_contacts: { name: string }[] }

// Kundenstamm: Liste mit Kundengruppen, Suche und fälligen Wiedervorlagen
export function Customers() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [group, setGroup] = useState<CustomerGroup | ''>(() => {
    try {
      return (localStorage.getItem('kunden-gruppe') as CustomerGroup) || ''
    } catch {
      return ''
    }
  })
  const [query, setQuery] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const [counts, setCounts] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')

  // Seit dem 3E-Abgleich sind es über 20.000 Kunden: Suche, Gruppen und Zähler macht die Datenbank (RPC search_customers)
  useEffect(() => {
    let stale = false
    const t = setTimeout(async () => {
      setLoading(true)
      const { data, error } = await supabase.rpc('search_customers', {
        p_query: query.trim(),
        p_group: group,
        p_inactive: showInactive,
        p_limit: LIMIT,
      })
      if (stale) return
      setError(error ? `Suche fehlgeschlagen: ${error.message}` : '')
      const res = (data ?? {}) as { rows?: Row[]; total?: number; counts?: Record<string, number> }
      setRows(res.rows ?? [])
      setTotal(res.total ?? 0)
      setCounts(res.counts ?? {})
      setLoading(false)
    }, query ? 300 : 0)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [query, group, showInactive])

  function chooseGroup(g: CustomerGroup | '') {
    setGroup(g)
    try {
      localStorage.setItem('kunden-gruppe', g)
    } catch {
      // ohne Speicher einfach nicht merken
    }
  }

  const all = Object.values(counts).reduce((a, b) => a + b, 0)
  const visible = rows

  return (
    <div>
      <div className="page-head">
        <h1>Kunden</h1>
        <Link className="button primary" to={group ? `/kunden/neu?gruppe=${group}` : '/kunden/neu'}>
          + Neuer Kunde
        </Link>
      </div>

      {profile && <FollowUpList me={profile.id} />}

      <div className="chip-row" role="group" aria-label="Kundengruppe">
        <button type="button" className={group === '' ? 'chip active' : 'chip'} onClick={() => chooseGroup('')}>
          Alle <span className="chip-count">{all}</span>
        </button>
        {CUSTOMER_GROUPS.map((g) => (
          <button type="button" key={g} className={group === g ? `chip active group-${g}` : `chip group-${g}`} onClick={() => chooseGroup(g)}>
            {GROUP_PLURAL[g]} <span className="chip-count">{counts[g] ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="filters">
        <input type="search" placeholder="Name, Kundennummer, Ort, Ansprechpartner…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="checkbox">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          inaktive
        </label>
      </div>

      {error && <p className="error">{error}</p>}
      {loading ? (
        <p className="muted">Lädt…</p>
      ) : visible.length === 0 ? (
        <p className="muted">{all === 0 && !query ? 'Noch keine Kunden angelegt.' : 'Keine Kunden gefunden.'}</p>
      ) : (
        <>
        {total > visible.length && <p className="small muted">{visible.length} von {total} Kunden angezeigt. Bitte Suche eingrenzen.</p>}
        <ul className="ticket-list">
          {visible.map((c) => (
            <li key={c.id}>
              <Link to={`/kunden/${c.id}`} className={`card ticket-row ${c.active ? '' : 'inactive'}`}>
                <div className="ticket-row-top">
                  <span className="ticket-no">{c.customer_number}</span>
                  <GroupBadge group={c.customer_group} />
                </div>
                <div className="ticket-title">
                  {c.name}
                  {c.name2 && <span className="muted"> · {c.name2}</span>}
                </div>
                {customerAddress(c) && <div className="small">{customerAddress(c)}</div>}
                <div className="small muted">
                  {[
                    c.phone,
                    c.email,
                    c.customer_contacts.length > 0 && `${c.customer_contacts.length} Ansprechpartner`,
                    plural(c.tickets[0]?.count ?? 0, 'Auftrag', 'Aufträge'),
                    plural(c.customer_notes[0]?.count ?? 0, 'Eintrag', 'Einträge'),
                    !c.active && 'inaktiv',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </Link>
            </li>
          ))}
        </ul>
        </>
      )}
    </div>
  )
}

export function GroupBadge({ group }: { group: CustomerGroup }) {
  return <span className={`group-tag group-${group}`}>{GROUP_LABEL[group]}</span>
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}
