import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { FollowUpList } from '../components/FollowUpList'
import { CUSTOMER_GROUPS, GROUP_LABEL, GROUP_PLURAL, customerAddress, type Customer, type CustomerGroup } from '../lib/customers'
import { supabase } from '../lib/supabase'

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

  useEffect(() => {
    supabase
      .from('customers')
      .select('*, tickets(count), customer_notes(count), customer_contacts(name)')
      .order('name')
      .then(({ data }) => {
        setRows((data ?? []) as Row[])
        setLoading(false)
      })
  }, [])

  function chooseGroup(g: CustomerGroup | '') {
    setGroup(g)
    try {
      localStorage.setItem('kunden-gruppe', g)
    } catch {
      // ohne Speicher einfach nicht merken
    }
  }

  const active = rows.filter((c) => showInactive || c.active)
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of active) m[c.customer_group] = (m[c.customer_group] ?? 0) + 1
    return m
  }, [active])

  const q = query.trim().toLowerCase()
  const visible = active.filter(
    (c) =>
      (!group || c.customer_group === group) &&
      (!q ||
        [c.customer_number, c.name, c.name2, c.city, c.zip, c.street, c.email, c.phone, ...c.customer_contacts.map((p) => p.name)]
          .join(' ')
          .toLowerCase()
          .includes(q)),
  )

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
          Alle <span className="chip-count">{active.length}</span>
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

      {loading ? (
        <p className="muted">Lädt…</p>
      ) : visible.length === 0 ? (
        <p className="muted">{rows.length === 0 ? 'Noch keine Kunden angelegt.' : 'Keine Kunden gefunden.'}</p>
      ) : (
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
