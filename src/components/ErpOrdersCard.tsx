import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatDay, ticketNo, type Ticket } from '../lib/types'

export interface ErpOrder {
  id: number
  doc_number: string
  doc_extension?: string
  doc_kind: string
  title: string
  doc_date: string | null
  delivery_date: string | null
  status: string
  amount_net: number | null
  notes: string
  customer_id: number | null
  project_id: number | null
  projects: { project_number: string; name: string } | null
  customers?: { name: string; customer_number: string } | null
}

const euro = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })

// Aufträge bzw. Angebote (docType) aus 3E, schreibgeschützt, im Bauvorhaben oder beim Kunden. Muss ein Auftrag montiert
// werden, wird daraus ein Montageauftrag angelegt; vorhandene App-Aufträge mit derselben Auftragsnummer stehen daneben.
export function ErpOrdersCard({
  projectId,
  customerId,
  tickets,
  docType = 'auftrag',
}: {
  projectId?: number
  customerId?: number
  tickets: Ticket[]
  docType?: 'auftrag' | 'angebot'
}) {
  const [orders, setOrders] = useState<ErpOrder[]>([])

  useEffect(() => {
    let q = supabase.from('erp_documents').select('*, projects(project_number, name)').eq('doc_type', docType)
    q = projectId ? q.eq('project_id', projectId) : q.eq('customer_id', customerId ?? 0)
    // ohne die Migration gibt es die Tabelle noch nicht: dann bleibt die Liste einfach leer
    q.order('doc_date', { ascending: false, nullsFirst: false }).limit(200).then(({ data }) => setOrders((data ?? []) as ErpOrder[]))
  }, [projectId, customerId, docType])

  if (orders.length === 0) return null

  return (
    <section className="card">
      <h2>
        {docType === 'angebot' ? 'Angebote' : 'Aufträge'} aus 3E ({orders.length})
      </h2>
      <ul className="history">
        {orders.map((o) => (
          <ErpOrderItem key={o.id} order={o} tickets={tickets} showProject={!projectId} offer={docType === 'angebot'} />
        ))}
      </ul>
    </section>
  )
}

// Ein 3E-Auftrag (oder mit offer ein Angebot) als Listenzeile; showProject/showCustomer zeigen Bauvorhaben bzw. Kunde mit Link
export function ErpOrderItem({
  order: o,
  tickets,
  showProject,
  showCustomer,
  offer,
}: {
  order: ErpOrder
  tickets: Ticket[]
  showProject?: boolean
  showCustomer?: boolean
  offer?: boolean
}) {
  const linked = o.doc_number && !offer ? tickets.filter((t) => t.order_number.trim() === o.doc_number) : []
  const params = new URLSearchParams({ art: 'montageauftrag', auftrag: o.doc_number, titel: o.title })
  if (o.project_id) params.set('bv', String(o.project_id))
  if (o.customer_id) params.set('kunde', String(o.customer_id))
  return (
    <li>
      <span className="customer-ticket">
        <strong>{o.doc_number || 'ohne Nummer'}</strong>
        {o.doc_extension && <span> · Erweiterung {o.doc_extension}</span>}
        {[o.doc_kind, o.status].filter(Boolean).map((x) => <span key={x} className="muted small"> · {x}</span>)}
      </span>
      <span>{o.title}</span>
      <span className="muted small">
        {[
          o.doc_date && `vom ${formatDay(o.doc_date)}`,
          o.delivery_date && `Wunschtermin ${formatDay(o.delivery_date)}`,
          o.amount_net != null && `${euro(Number(o.amount_net))} netto`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
      {showCustomer && o.customer_id && o.customers && (
        <span className="small">
          <span className="muted">Kunde: </span>
          <Link to={`/kunden/${o.customer_id}`}>{[o.customers.customer_number, o.customers.name].filter(Boolean).join(' ')}</Link>
        </span>
      )}
      {showProject && o.project_id && o.projects && (
        <span className="small">
          <span className="muted">Bauvorhaben: </span>
          <Link to={`/bauvorhaben/${o.project_id}`}>{[o.projects.project_number, o.projects.name].filter(Boolean).join(' ')}</Link>
        </span>
      )}
      {o.notes && <span className="pre small muted">{o.notes}</span>}
      {!offer && (
        <span className="small">
          {linked.map((t) => (
            <span key={t.id}>
              <Link to={`/ticket/${t.id}`}>{ticketNo(t.id, t.ticket_type)}</Link>{' · '}
            </span>
          ))}
          <Link to={`/neu?${params}`}>+ Montageauftrag anlegen</Link>
        </span>
      )}
    </li>
  )
}

// Auftragsübersicht, Ansicht "Aufträge aus 3E": serverseitige Suche über alle 3E-Aufträge
export function ErpOrderList({ query, kind, tickets }: { query: string; kind: string; tickets: Ticket[] }) {
  const [rows, setRows] = useState<ErpOrder[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let stale = false
    const t = setTimeout(() => {
      setLoading(true)
      supabase.rpc('search_erp_documents', { p_query: query, p_kind: kind, p_limit: 100 }).then(({ data, error }) => {
        if (stale) return
        setError(error ? error.message : '')
        setRows(((data as { rows?: ErpOrder[] } | null)?.rows ?? []))
        setTotal((data as { total?: number } | null)?.total ?? 0)
        setLoading(false)
      })
    }, 250)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [query, kind])

  if (error) return <p className="error">Aufträge aus 3E konnten nicht geladen werden: {error}</p>
  if (loading && rows.length === 0) return <p className="muted">Lädt…</p>
  if (rows.length === 0) return <p className="muted">Keine Aufträge aus 3E gefunden.</p>
  return (
    <section className="card">
      <p className="small muted">
        {total > rows.length ? `${rows.length} von ${total} Aufträgen, die neuesten zuerst. Für ältere bitte suchen.` : `${total} Aufträge`}
      </p>
      <ul className="history">
        {rows.map((o) => (
          <ErpOrderItem key={o.id} order={o} tickets={tickets} showProject showCustomer />
        ))}
      </ul>
    </section>
  )
}
