import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { BILLING_LABEL, displayName, formatDate, formatEuro, type Profile, type Ticket, type TicketPosition } from '../lib/types'

interface Props {
  ticket: Ticket
  positions: TicketPosition[]
  byId: Record<string, Profile>
  canEdit: boolean
  isAdmin: boolean
  onChanged: () => Promise<void>
}

function toText(n: number | null) {
  return n == null ? '' : n.toFixed(2).replace('.', ',')
}

// "12,50" / "1.234,5" / "12.5" -> 12.5; leer -> null; ungültig -> NaN
function parsePrice(s: string) {
  const v = s.trim().replace(/\s|€/g, '')
  if (!v) return null
  const normalized = v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v
  return /^\d+(\.\d{0,2})?$/.test(normalized) ? Number(normalized) : NaN
}

// Preise je Position eintragen, solange ein Reparaturauftrag zur Berechnung steht
export function BillingCard({ ticket: t, positions, byId, canEdit, isAdmin, onChanged }: Props) {
  const [texts, setTexts] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setTexts(Object.fromEntries(positions.map((p) => [p.id, toText(p.price)])))
  }, [positions])

  const open = t.billing_state === 'zur_berechnung'
  const editable = open && canEdit
  const total = positions.reduce((sum, p) => sum + (p.price ?? 0), 0)
  const missing = positions.filter((p) => p.price == null).length

  async function savePrice(p: TicketPosition) {
    const price = parsePrice(texts[p.id] ?? '')
    if (Number.isNaN(price)) {
      setError('Bitte den Preis als Zahl eingeben, z. B. 49,90')
      return
    }
    if (price === p.price) return
    setBusy(true)
    setError('')
    const { error } = await supabase.rpc('set_position_price', { p_position_id: p.id, p_price: price })
    if (error) setError(error.message)
    await onChanged()
    setBusy(false)
  }

  async function run(fn: string) {
    setBusy(true)
    setError('')
    const { error } = await supabase.rpc(fn, { p_ticket_id: t.id })
    if (error) setError(error.message)
    await onChanged()
    setBusy(false)
  }

  return (
    <section className="card">
      <h2>
        Berechnung <span className={`badge badge-${t.billing_state}`}>{BILLING_LABEL[t.billing_state as 'zur_berechnung' | 'berechnet']}</span>
      </h2>
      {positions.length === 0 ? (
        <p className="muted">Der Auftrag hat keine Positionen, deshalb können keine Preise eingetragen werden.</p>
      ) : (
        <>
          <ul className="billing-list">
            {positions.map((p) => (
              <li key={p.id}>
                <div className="billing-text">
                  {p.position_number && <strong>Pos. {p.position_number}</strong>}
                  {p.position_number && p.description && ' – '}
                  <span className="pre">{p.description}</span>
                  <div className={`small ${p.state === 'erledigt' ? 'state-ok' : 'state-no'}`}>
                    {p.state === 'erledigt' ? '✓ Erledigt' : p.state === 'nicht_erledigt' ? '✗ Nicht erledigt' : 'offen'}
                  </div>
                </div>
                {editable ? (
                  <input
                    className="billing-price"
                    inputMode="decimal"
                    placeholder="0,00 €"
                    aria-label={`Preis Position ${p.position_number || p.sort + 1}`}
                    value={texts[p.id] ?? ''}
                    disabled={busy}
                    onChange={(e) => setTexts({ ...texts, [p.id]: e.target.value })}
                    onBlur={() => savePrice(p)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <span className="billing-amount">{formatEuro(p.price)}</span>
                )}
              </li>
            ))}
          </ul>
          <div className="billing-total">
            <span>Summe (netto)</span>
            <span className="billing-amount">{formatEuro(total)}</span>
          </div>
        </>
      )}

      {t.billing_state === 'berechnet' && t.billed_at && (
        <p className="small">
          Berechnet am {formatDate(t.billed_at)}
          {t.billed_by && <> von {displayName(byId[t.billed_by])}</>}
        </p>
      )}

      {editable && positions.length > 0 && (
        <div className="actions">
          {missing > 0 && <span className="muted small">Noch {missing} Position(en) ohne Preis</span>}
          <button className="primary" disabled={busy || missing > 0} onClick={() => run('finish_billing')}>
            Berechnung abschließen
          </button>
        </div>
      )}
      {t.billing_state === 'berechnet' && isAdmin && (
        <div className="actions">
          <button disabled={busy} onClick={() => run('reopen_billing')}>Berechnung wieder öffnen</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}
