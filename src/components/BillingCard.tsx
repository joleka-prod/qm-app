import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { billingAddressLine } from './BillingAddressFields'
import { BILLING_LABEL, displayName, formatDate, formatEuro, type Profile, type Ticket, type TicketPosition, UNITS, UNIT_HINT } from '../lib/types'

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

function qtyText(n: number) {
  return String(n).replace('.', ',')
}


type Row = { quantity: string; unit: string; price: string }

// "12,50" / "1.234,5" / "12.5" -> 12.5; leer -> null; ungültig -> NaN
function parsePrice(s: string) {
  const v = s.trim().replace(/\s|€/g, '')
  if (!v) return null
  const normalized = v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v
  return /^\d+(\.\d{0,2})?$/.test(normalized) ? Number(normalized) : NaN
}

// Preise je Position eintragen, solange ein Reparaturauftrag zur Berechnung steht
export function BillingCard({ ticket: t, positions, byId, canEdit, isAdmin, onChanged }: Props) {
  const [rows, setRows] = useState<Record<number, Row>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setRows(Object.fromEntries(positions.map((p) => [p.id, { quantity: qtyText(p.quantity), unit: p.unit, price: toText(p.price) }])))
  }, [positions])

  const open = t.billing_state === 'zur_berechnung'
  const editable = open && canEdit
  const amount = (p: TicketPosition) => (p.price == null ? null : Math.round(p.quantity * p.price * 100) / 100)
  const total = positions.reduce((sum, p) => sum + (amount(p) ?? 0), 0)
  const missing = positions.filter((p) => p.price == null).length

  async function saveRow(p: TicketPosition) {
    const row = rows[p.id]
    if (!row) return
    const price = parsePrice(row.price)
    const quantity = parsePrice(row.quantity)
    const unit = row.unit.trim()
    if (Number.isNaN(price)) return setError('Bitte den Einzelpreis als Zahl eingeben, z. B. 49,90')
    if (quantity == null || Number.isNaN(quantity) || quantity <= 0) return setError('Bitte eine Menge größer als 0 eingeben, z. B. 1 oder 2,5')
    if (!unit) return setError('Bitte eine Einheit angeben, z. B. Stk oder Std')
    if (price === p.price && quantity === p.quantity && unit === p.unit) return
    setBusy(true)
    setError('')
    const { error } = await supabase.rpc('set_position_billing', {
      p_position_id: p.id,
      p_quantity: quantity,
      p_unit: unit,
      p_price: price,
    })
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
      <p className="small">
        <span className="muted">Rechnung an: </span>
        {t.billing_address_different ? billingAddressLine(t) : [t.customer_name, t.site_address.replace(/\s*\n\s*/g, ', ')].filter(Boolean).join(', ') || '–'}
      </p>
      {positions.length === 0 ? (
        <p className="muted">Der Auftrag hat keine Positionen, deshalb können keine Preise eingetragen werden.</p>
      ) : (
        <>
          <datalist id="billing-units">
            {UNITS.map((u) => (
              <option key={u} value={u}>{UNIT_HINT[u]}</option>
            ))}
          </datalist>
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
                  <div className="billing-inputs">
                    <label>
                      Menge
                      <input
                        inputMode="decimal"
                        value={rows[p.id]?.quantity ?? ''}
                        disabled={busy}
                        onChange={(e) => setRows({ ...rows, [p.id]: { ...rows[p.id], quantity: e.target.value } })}
                        onBlur={() => saveRow(p)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      />
                    </label>
                    <label>
                      Einheit
                      <input
                        list="billing-units"
                        maxLength={20}
                        value={rows[p.id]?.unit ?? ''}
                        disabled={busy}
                        onChange={(e) => setRows({ ...rows, [p.id]: { ...rows[p.id], unit: e.target.value } })}
                        onBlur={() => saveRow(p)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      />
                    </label>
                    <label>
                      Einzelpreis €
                      <input
                        className="billing-price"
                        inputMode="decimal"
                        placeholder="0,00"
                        aria-label={`Einzelpreis Position ${p.position_number || p.sort + 1}`}
                        value={rows[p.id]?.price ?? ''}
                        disabled={busy}
                        onChange={(e) => setRows({ ...rows, [p.id]: { ...rows[p.id], price: e.target.value } })}
                        onBlur={() => saveRow(p)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      />
                    </label>
                    <span className="billing-amount">{formatEuro(amount(p))}</span>
                  </div>
                ) : (
                  <div className="billing-readonly">
                    <span className="small muted">
                      {qtyText(p.quantity)} {p.unit} × {formatEuro(p.price)}
                    </span>
                    <span className="billing-amount">{formatEuro(amount(p))}</span>
                  </div>
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
