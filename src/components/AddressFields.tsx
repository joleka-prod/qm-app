import type { Ticket } from '../lib/types'

// Abweichende Adresse am Auftrag: Rechnungsadresse (billing_*) oder Baustellenadresse (jobsite_*)
export type AddressKind = 'billing' | 'jobsite'

export interface AltAddress {
  different: boolean
  name: string
  street: string
  house_no: string
  zip: string
  city: string
}

export const emptyAddress: AltAddress = { different: false, name: '', street: '', house_no: '', zip: '', city: '' }

const FIELDS = ['name', 'street', 'house_no', 'zip', 'city'] as const

export function addressOf(t: Ticket, kind: AddressKind): AltAddress {
  const r = t as unknown as Record<string, string | boolean>
  const a = { ...emptyAddress, different: !!r[`${kind}_address_different`] }
  for (const f of FIELDS) a[f] = (r[`${kind}_${f}`] as string) ?? ''
  return a
}

// Spalten für insert/update
export function addressColumns(a: AltAddress, kind: AddressKind) {
  const row: Record<string, string | boolean> = { [`${kind}_address_different`]: a.different }
  for (const f of FIELDS) row[`${kind}_${f}`] = a.different ? a[f].trim() : ''
  return row
}

// Pflichtfelder: Straße, PLZ, Ort; bei der Rechnungsadresse auch der Name
export function addressComplete(a: AltAddress, kind: AddressKind) {
  const req = [a.street, a.zip, a.city, ...(kind === 'billing' ? [a.name] : [])]
  return !a.different || req.every((v) => v.trim())
}

// "Name, Straße Nr., PLZ Ort"
export function addressLine(a: AltAddress, withName = true) {
  if (!a.different) return ''
  return [withName ? a.name : '', `${a.street} ${a.house_no}`.trim(), `${a.zip} ${a.city}`.trim()].filter(Boolean).join(', ')
}

// Wo der Einsatz stattfindet: Baustelle, sonst Kundenadresse (mehrzeilig)
export function jobAddress(t: Ticket) {
  const j = addressOf(t, 'jobsite')
  if (!j.different) return t.site_address.trim()
  return [`${j.street} ${j.house_no}`.trim(), `${j.zip} ${j.city}`.trim()].join('\n')
}

const TITLE: Record<AddressKind, string> = { billing: 'Rechnungsadresse', jobsite: 'Baustellenadresse' }

export function AddressFields({ kind, value, onChange }: { kind: AddressKind; value: AltAddress; onChange: (v: AltAddress) => void }) {
  const set = (patch: Partial<AltAddress>) => onChange({ ...value, ...patch })
  const nameRequired = kind === 'billing'
  return (
    <>
      <label className="checkbox-row">
        <input type="checkbox" checked={value.different} onChange={(e) => set({ different: e.target.checked })} />
        Abweichende {TITLE[kind]}
      </label>
      {value.different && (
        <fieldset className="billing-address">
          <legend>{TITLE[kind]}</legend>
          <label>
            {nameRequired ? 'Name *' : 'Name / Bezeichnung'}
            <input required={nameRequired} value={value.name} maxLength={150} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <div className="row street-row">
            <label>
              Straße *
              <input required value={value.street} maxLength={150} onChange={(e) => set({ street: e.target.value })} />
            </label>
            <label>
              Hausnummer
              <input value={value.house_no} maxLength={20} onChange={(e) => set({ house_no: e.target.value })} />
            </label>
          </div>
          <div className="row zip-row">
            <label>
              PLZ *
              <input required inputMode="numeric" value={value.zip} maxLength={10} onChange={(e) => set({ zip: e.target.value })} />
            </label>
            <label>
              Ort *
              <input required value={value.city} maxLength={100} onChange={(e) => set({ city: e.target.value })} />
            </label>
          </div>
        </fieldset>
      )}
    </>
  )
}

// Kundendaten: Kundennummer zuerst, Adresse in Feldern wie bei der Rechnungsadresse
export interface CustomerData {
  customer_number: string
  customer_name: string
  customer_street: string
  customer_house_no: string
  customer_zip: string
  customer_city: string
  customer_email: string
}

export const emptyCustomer: CustomerData = {
  customer_number: '',
  customer_name: '',
  customer_street: '',
  customer_house_no: '',
  customer_zip: '',
  customer_city: '',
  customer_email: '',
}

export function customerOf(t: Ticket): CustomerData {
  return {
    customer_number: t.customer_number,
    customer_name: t.customer_name,
    customer_street: t.customer_street,
    customer_house_no: t.customer_house_no,
    customer_zip: t.customer_zip,
    customer_city: t.customer_city,
    customer_email: t.customer_email,
  }
}

export function customerColumns(c: CustomerData) {
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.trim()])) as unknown as CustomerData
}

export function CustomerFields({ value, onChange }: { value: CustomerData; onChange: (v: CustomerData) => void }) {
  const set = (patch: Partial<CustomerData>) => onChange({ ...value, ...patch })
  return (
    <fieldset className="billing-address">
      <legend>Kunde</legend>
      <label>
        Kundennummer
        <input value={value.customer_number} maxLength={30} onChange={(e) => set({ customer_number: e.target.value })} />
      </label>
      <label>
        Name
        <input value={value.customer_name} maxLength={150} onChange={(e) => set({ customer_name: e.target.value })} />
      </label>
      <div className="row street-row">
        <label>
          Straße
          <input value={value.customer_street} maxLength={150} onChange={(e) => set({ customer_street: e.target.value })} />
        </label>
        <label>
          Hausnummer
          <input value={value.customer_house_no} maxLength={20} onChange={(e) => set({ customer_house_no: e.target.value })} />
        </label>
      </div>
      <div className="row zip-row">
        <label>
          PLZ
          <input inputMode="numeric" value={value.customer_zip} maxLength={10} onChange={(e) => set({ customer_zip: e.target.value })} />
        </label>
        <label>
          Ort
          <input value={value.customer_city} maxLength={100} onChange={(e) => set({ customer_city: e.target.value })} />
        </label>
      </div>
      <label>
        E-Mail
        <input
          type="email"
          inputMode="email"
          autoComplete="off"
          value={value.customer_email}
          maxLength={200}
          onChange={(e) => set({ customer_email: e.target.value })}
          placeholder="name@beispiel.de"
        />
      </label>
    </fieldset>
  )
}
