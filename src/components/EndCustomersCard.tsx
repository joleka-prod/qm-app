import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { GROUP_LABEL, searchCustomers, type Customer } from '../lib/customers'
import { supabase } from '../lib/supabase'
import { ticketNo, type Ticket } from '../lib/types'

// Kundengruppen, denen Endkunden zugeordnet werden können
export const PARTNER_GROUPS = ['bautraeger', 'generalunternehmer', 'architekt']

type TicketRef = Pick<Ticket, 'id' | 'title' | 'ticket_type'>

interface Relation {
  id: number
  partner_id: number
  end_customer_id: number
  project: string
  ticket_id: number | null
  note: string
  created_at: string
  partner: Customer
  end_customer: Customer
  tickets: TicketRef | null
}

const SELECT =
  '*, partner:customers!customer_end_customers_partner_id_fkey(*), end_customer:customers!customer_end_customers_end_customer_id_fkey(*), tickets(id, title, ticket_type)'

function ticketLabel(t: TicketRef) {
  return `${ticketNo(t.id, t.ticket_type)} ${t.title}`
}

// Kundenakte: Endkunden eines Bauträgers / GU / Architekten (nach Projekt) und umgekehrt "Zugeordnet zu"
export function EndCustomersCard({ customer, tickets }: { customer: Customer; tickets: Ticket[] }) {
  const isPartner = PARTNER_GROUPS.includes(customer.customer_group)
  const [ends, setEnds] = useState<Relation[]>([])
  const [partners, setPartners] = useState<Relation[]>([])
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase.from('customer_end_customers').select(SELECT).eq('partner_id', customer.id).order('project').order('created_at'),
      supabase.from('customer_end_customers').select(SELECT).eq('end_customer_id', customer.id).order('created_at'),
    ])
    setEnds((a.data ?? []) as Relation[])
    setPartners((b.data ?? []) as Relation[])
  }, [customer.id])

  useEffect(() => {
    load()
  }, [load])

  async function remove(r: Relation) {
    if (!confirm(`Zuordnung von „${r.end_customer.name}“ zu „${r.partner.name}“ lösen?`)) return
    const { error } = await supabase.from('customer_end_customers').delete().eq('id', r.id)
    if (error) setError(error.message)
    await load()
  }

  // Nach Projekt gruppieren; ohne Projekt nach Auftrag
  const groups = useMemo(() => {
    const m = new Map<string, Relation[]>()
    for (const r of ends) {
      const key = r.project || (r.tickets ? `Auftrag ${ticketLabel(r.tickets)}` : '')
      m.set(key, [...(m.get(key) ?? []), r])
    }
    return [...m.entries()]
  }, [ends])

  if (!isPartner && partners.length === 0) return null

  return (
    <>
      {isPartner && (
        <section className="card">
          <div className="card-head">
            <h2>Endkunden ({new Set(ends.map((r) => r.end_customer_id)).size})</h2>
            {!adding && <button onClick={() => { setError(''); setAdding(true) }}>+ Endkunde zuordnen</button>}
          </div>
          {adding && (
            <AssignForm
              partner={customer}
              partnerTickets={tickets}
              projects={[...new Set(ends.map((r) => r.project).filter(Boolean))]}
              onDone={async () => {
                setAdding(false)
                await load()
              }}
            />
          )}
          {ends.length === 0 && !adding ? (
            <p className="muted">Noch keine Endkunden zugeordnet.</p>
          ) : (
            groups.map(([key, rows]) => (
              <div key={key} className="project-group">
                <h3 className="project-name">{key}</h3>
                <ul className="history">
                  {rows.map((r) => (
                    <li key={r.id} className="contact-row">
                      <div>
                        <Link to={`/kunden/${r.end_customer_id}`}>
                          {r.end_customer.customer_number} {r.end_customer.name}
                        </Link>
                        {r.end_customer.city && <span className="muted small"> · {r.end_customer.zip} {r.end_customer.city}</span>}
                        {r.project && r.tickets && (
                          <div className="small">
                            <Link to={`/ticket/${r.tickets.id}`}>{ticketLabel(r.tickets)}</Link>
                          </div>
                        )}
                        {r.note && <div className="small muted">{r.note}</div>}
                      </div>
                      <button className="link danger-link" onClick={() => remove(r)}>lösen</button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {partners.length > 0 && (
        <section className="card">
          <h2>Zugeordnet zu</h2>
          <ul className="history">
            {partners.map((r) => (
              <li key={r.id} className="contact-row">
                <div>
                  <Link to={`/kunden/${r.partner_id}`}>
                    {r.partner.customer_number} {r.partner.name}
                  </Link>
                  <span className="muted small"> · {GROUP_LABEL[r.partner.customer_group]}</span>
                  <div className="small">
                    {r.project && <>Projekt: {r.project}</>}
                    {r.project && r.tickets && ' · '}
                    {r.tickets && <Link to={`/ticket/${r.tickets.id}`}>{ticketLabel(r.tickets)}</Link>}
                  </div>
                  {r.note && <div className="small muted">{r.note}</div>}
                </div>
                <button className="link danger-link" onClick={() => remove(r)}>lösen</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function AssignForm({
  partner,
  partnerTickets,
  projects,
  onDone,
}: {
  partner: Customer
  partnerTickets: Ticket[]
  projects: string[]
  onDone: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Customer[]>([])
  const [picked, setPicked] = useState<Customer | null>(null)
  const [endTickets, setEndTickets] = useState<TicketRef[]>([])
  const [project, setProject] = useState('')
  const [ticketId, setTicketId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (picked || query.trim().length < 2) {
      setMatches([])
      return
    }
    let stale = false
    const t = setTimeout(async () => {
      const found = (await searchCustomers(query)).filter((c) => c.id !== partner.id)
      if (!stale) setMatches(found)
    }, 250)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [query, picked, partner.id])

  // Aufträge des Endkunden zusätzlich zur Auswahl anbieten
  useEffect(() => {
    if (!picked) return setEndTickets([])
    supabase
      .from('tickets')
      .select('id, title, ticket_type')
      .eq('customer_id', picked.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setEndTickets((data ?? []) as TicketRef[]))
  }, [picked])

  const ticketOptions = [...partnerTickets, ...endTickets.filter((t) => !partnerTickets.some((p) => p.id === t.id))]

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!picked) return
    setBusy(true)
    setError('')
    const { error } = await supabase.from('customer_end_customers').insert({
      partner_id: partner.id,
      end_customer_id: picked.id,
      project: project.trim(),
      ticket_id: ticketId ? Number(ticketId) : null,
      note: note.trim(),
    })
    setBusy(false)
    if (error) return setError(/customer_end_customers_unique/.test(error.message) ? 'Diese Zuordnung gibt es schon.' : error.message)
    await onDone()
  }

  return (
    <form className="form note-form" onSubmit={save}>
      {picked ? (
        <p className="customer-summary">
          <span>
            <strong>{picked.customer_number} {picked.name}</strong>
            <span className="muted small"> · {GROUP_LABEL[picked.customer_group]}{picked.city && ` · ${picked.zip} ${picked.city}`}</span>
          </span>
          <button type="button" className="link" onClick={() => setPicked(null)}>anderer Kunde</button>
        </p>
      ) : (
        <label>
          Endkunde *
          <input autoFocus autoComplete="off" value={query} placeholder="Name oder Kundennummer eintippen" onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}
      {matches.length > 0 && !picked && (
        <ul className="address-suggest" role="listbox" aria-label="Kunden">
          {matches.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setPicked(c)}>
                <strong>{c.customer_number}</strong> {c.name}
                <span className="muted small"> · {GROUP_LABEL[c.customer_group]}{c.city && ` · ${c.zip} ${c.city}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!picked && query.trim().length >= 2 && matches.length === 0 && (
        <p className="small muted">
          Kein Kunde gefunden. <Link to="/kunden/neu?gruppe=privat">Neuen Kunden anlegen</Link> und danach hier zuordnen.
        </p>
      )}
      <div className="row">
        <label>
          Projekt / Bauvorhaben
          <input list="partner-projects" maxLength={200} value={project} onChange={(e) => setProject(e.target.value)} placeholder="z. B. Wohnpark Daun, Haus 3" />
          <datalist id="partner-projects">
            {projects.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label>
          Auftrag
          <select value={ticketId} onChange={(e) => setTicketId(e.target.value)}>
            <option value="">–</option>
            {ticketOptions.map((t) => (
              <option key={t.id} value={t.id}>{ticketLabel(t)}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Bemerkung
        <input maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="muted small">Projekt oder Auftrag ist Pflicht.</p>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => onDone()}>Abbrechen</button>
        <button className="primary" disabled={busy || !picked || (!project.trim() && !ticketId)}>Zuordnen</button>
      </div>
    </form>
  )
}
