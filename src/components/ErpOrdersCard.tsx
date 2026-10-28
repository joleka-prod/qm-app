import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatDay, ticketNo, type Ticket } from '../lib/types'

interface ErpOrder {
  id: number
  doc_number: string
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
}

const euro = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })

// Aufträge aus 3E (schreibgeschützt) im Bauvorhaben bzw. beim Kunden. Muss einer montiert werden, wird daraus ein
// Montageauftrag angelegt; vorhandene App-Aufträge mit derselben Auftragsnummer werden daneben angezeigt.
export function ErpOrdersCard({ projectId, customerId, tickets }: { projectId?: number; customerId?: number; tickets: Ticket[] }) {
  const [orders, setOrders] = useState<ErpOrder[]>([])

  useEffect(() => {
    let q = supabase.from('erp_documents').select('*, projects(project_number, name)').eq('doc_type', 'auftrag')
    q = projectId ? q.eq('project_id', projectId) : q.eq('customer_id', customerId ?? 0)
    // ohne die Migration gibt es die Tabelle noch nicht: dann bleibt die Liste einfach leer
    q.order('doc_date', { ascending: false, nullsFirst: false }).limit(200).then(({ data }) => setOrders((data ?? []) as ErpOrder[]))
  }, [projectId, customerId])

  if (orders.length === 0) return null

  return (
    <section className="card">
      <h2>Aufträge aus 3E ({orders.length})</h2>
      <ul className="history">
        {orders.map((o) => {
          const linked = o.doc_number ? tickets.filter((t) => t.order_number.trim() === o.doc_number) : []
          const params = new URLSearchParams({ art: 'montageauftrag', auftrag: o.doc_number, titel: o.title })
          if (o.project_id) params.set('bv', String(o.project_id))
          if (o.customer_id) params.set('kunde', String(o.customer_id))
          return (
            <li key={o.id}>
              <span className="customer-ticket">
                <strong>{o.doc_number || 'ohne Nummer'}</strong>
                {[o.doc_kind, o.status].filter(Boolean).map((x) => <span key={x} className="muted small"> · {x}</span>)}
              </span>
              <span>{o.title}</span>
              <span className="muted small">
                {[
                  o.doc_date && `vom ${formatDay(o.doc_date)}`,
                  o.delivery_date && `Wunschtermin ${formatDay(o.delivery_date)}`,
                  o.amount_net != null && `${euro(Number(o.amount_net))} netto`,
                  !projectId && o.projects && `Bauvorhaben ${[o.projects.project_number, o.projects.name].filter(Boolean).join(' ')}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {o.notes && <span className="pre small muted">{o.notes}</span>}
              <span className="small">
                {linked.map((t) => (
                  <span key={t.id}>
                    <Link to={`/ticket/${t.id}`}>{ticketNo(t.id, t.ticket_type)}</Link>{' · '}
                  </span>
                ))}
                <Link to={`/neu?${params}`}>+ Montageauftrag anlegen</Link>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
