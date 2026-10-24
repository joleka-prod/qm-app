import type { Ticket } from '../lib/types'

export type BillingAddress = Pick<
  Ticket,
  'billing_address_different' | 'billing_name' | 'billing_street' | 'billing_house_no' | 'billing_zip' | 'billing_city'
>

export const emptyBillingAddress: BillingAddress = {
  billing_address_different: false,
  billing_name: '',
  billing_street: '',
  billing_house_no: '',
  billing_zip: '',
  billing_city: '',
}

export function billingAddressOf(t: Ticket): BillingAddress {
  const { billing_address_different, billing_name, billing_street, billing_house_no, billing_zip, billing_city } = t
  return { billing_address_different, billing_name, billing_street, billing_house_no, billing_zip, billing_city }
}

// Pflichtfelder bei abweichender Rechnungsadresse
export function billingAddressComplete(b: BillingAddress) {
  return !b.billing_address_different || [b.billing_name, b.billing_street, b.billing_zip, b.billing_city].every((v) => v.trim())
}

// Für die Anzeige: "Name, Straße Nr., PLZ Ort"
export function billingAddressLine(b: BillingAddress) {
  if (!b.billing_address_different) return ''
  return [b.billing_name, `${b.billing_street} ${b.billing_house_no}`.trim(), `${b.billing_zip} ${b.billing_city}`.trim()]
    .filter(Boolean)
    .join(', ')
}

export function BillingAddressFields({ value, onChange }: { value: BillingAddress; onChange: (v: BillingAddress) => void }) {
  const set = (patch: Partial<BillingAddress>) => onChange({ ...value, ...patch })
  return (
    <>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={value.billing_address_different}
          onChange={(e) => set({ billing_address_different: e.target.checked })}
        />
        Abweichende Rechnungsadresse
      </label>
      {value.billing_address_different && (
        <fieldset className="billing-address">
          <legend>Rechnungsadresse</legend>
          <label>
            Name *
            <input required value={value.billing_name} maxLength={150} onChange={(e) => set({ billing_name: e.target.value })} />
          </label>
          <div className="row street-row">
            <label>
              Straße *
              <input required value={value.billing_street} maxLength={150} onChange={(e) => set({ billing_street: e.target.value })} />
            </label>
            <label>
              Hausnummer
              <input value={value.billing_house_no} maxLength={20} onChange={(e) => set({ billing_house_no: e.target.value })} />
            </label>
          </div>
          <div className="row zip-row">
            <label>
              PLZ *
              <input required inputMode="numeric" value={value.billing_zip} maxLength={10} onChange={(e) => set({ billing_zip: e.target.value })} />
            </label>
            <label>
              Ort *
              <input required value={value.billing_city} maxLength={100} onChange={(e) => set({ billing_city: e.target.value })} />
            </label>
          </div>
        </fieldset>
      )}
    </>
  )
}
