import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { loadChain } from '../lib/loaders'
import { supabase } from '../lib/supabase'
import { formatDay, statusLabel, ticketNo, type Ticket, type TicketStatus, type TicketType } from '../lib/types'

interface ChainRow {
  id: number
  parent_id: number | null
  ticket_type: TicketType
  title: string
  status: TicketStatus
  montage_date: string | null
  not_done: number
  not_done_items: string
  depth: number
}

// Auftragskette: Ursprungsauftrag und alle Folgeaufträge, dazu "Folgeauftrag erstellen" für die Disposition
export function OrderChain({ ticket, canCreate }: { ticket: Ticket; canCreate: boolean }) {
  const navigate = useNavigate()
  const [chain, setChain] = useState<ChainRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadChain(ticket.id).then(({ data }) => setChain((data ?? []) as ChainRow[]))
  }, [ticket.id, ticket.status])

  async function create() {
    if (!confirm('Folgeauftrag erstellen? Kunde, Adressen und alle nicht erledigten Positionen werden übernommen.')) return
    setBusy(true)
    setError('')
    const { data, error } = await supabase.rpc('create_followup', { p_ticket_id: ticket.id })
    setBusy(false)
    if (error) return setError(error.message)
    navigate(`/ticket/${data}`)
  }

  const parent = chain.find((r) => r.id === ticket.parent_id)
  if (chain.length < 2 && !canCreate) return null

  return (
    <section className="card">
      <h2>Auftragskette</h2>
      {parent && parent.not_done > 0 && (
        <div className="chain-open">
          <p className="small">
            Folgeauftrag zu <Link to={`/ticket/${parent.id}`}>{ticketNo(parent.id, parent.ticket_type)}</Link>. Dort nicht erledigt:
          </p>
          <ul className="small">
            {parent.not_done_items.split('\n').map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </div>
      )}
      {chain.length > 1 ? (
        <ul className="chain-list">
          {chain.map((r) => (
            <li key={r.id} style={{ paddingLeft: `${Math.min(r.depth, 6) * 1.1}rem` }} className={r.id === ticket.id ? 'current' : ''}>
              {r.depth > 0 && <span className="muted">↳ </span>}
              {r.id === ticket.id ? <strong>{ticketNo(r.id, r.ticket_type)}</strong> : <Link to={`/ticket/${r.id}`}>{ticketNo(r.id, r.ticket_type)}</Link>}
              {' '}{r.title}
              <span className="small muted">
                {' · '}{statusLabel(r.ticket_type, r.status)}
                {r.montage_date && <> · {formatDay(r.montage_date)}</>}
                {r.not_done > 0 && <> · {r.not_done} nicht erledigt</>}
                {r.depth === 0 && <> · Ursprungsauftrag</>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">Keine Folgeaufträge.</p>
      )}
      {canCreate && (
        <button disabled={busy} onClick={create}>+ Folgeauftrag erstellen</button>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}
