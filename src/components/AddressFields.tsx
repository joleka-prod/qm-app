import { useState } from 'react'
import type { Ticket } from '../lib/types'
import { AddressSuggest } from './AddressSuggest'

// Abweichende Adresse am Auftrag: Rechnungsadresse (billing_*) oder Baustellenadresse (jobsite_*)
export type AddressKind = 'billing' | 'jobsite'

export interface AltAddress {
  different: boolean
  name: string
  street: string
  house_no: string
  zip: string
  city: string
  country: string
}

export const DEFAULT_COUNTRY = 'Deutschland'
const COUNTRY_LIST = ['Deutschland', 'Luxemburg', 'Belgien', 'Niederlande', 'Frankreich', 'Österreich', 'Schweiz']

export const emptyAddress: AltAddress = { different: false, name: '', street: '', house_no: '', zip: '', city: '', country: DEFAULT_COUNTRY }

const FIELDS = ['name', 'street', 'house_no', 'zip', 'city', 'country'] as const

export function addressOf(t: Ticket, kind: AddressKind): AltAddress {
  const r = t as unknown as Record<string, string | boolean>
  const a = { ...emptyAddress, different: !!r[`${kind}_address_different`] }
  for (const f of FIELDS) a[f] = (r[`${kind}_${f}`] as string) ?? ''
  a.country ||= DEFAULT_COUNTRY
  return a
}

// Spalten für insert/update
export function addressColumns(a: AltAddress, kind: AddressKind) {
  const row: Record<string, string | boolean> = { [`${kind}_address_different`]: a.different }
  for (const f of FIELDS) row[`${kind}_${f}`] = a.different ? a[f].trim() : ''
  row[`${kind}_country`] = (a.different && a.country.trim()) || DEFAULT_COUNTRY
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
  return [withName ? a.name : '', `${a.street} ${a.house_no}`.trim(), `${a.zip} ${a.city}`.trim(), a.country === DEFAULT_COUNTRY ? '' : a.country]
    .filter(Boolean)
    .join(', ')
}

// Wo der Einsatz stattfindet: Baustelle, sonst Kundenadresse (mehrzeilig)
export function jobAddress(t: Ticket) {
  const j = addressOf(t, 'jobsite')
  if (!j.different) return t.site_address.trim()
  return [`${j.street} ${j.house_no}`.trim(), `${j.zip} ${j.city}`.trim(), j.country === DEFAULT_COUNTRY ? '' : j.country].filter(Boolean).join('\n')
}

const TITLE: Record<AddressKind, string> = { billing: 'Rechnungsadresse', jobsite: 'Baustellenadresse' }

export function AddressFields({ kind, value, onChange }: { kind: AddressKind; value: AltAddress; onChange: (v: AltAddress) => void }) {
  const set = (patch: Partial<AltAddress>) => onChange({ ...value, ...patch })
  const nameRequired = kind === 'billing'
  const [typing, setTyping] = useState(false)
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
              <input
                required
                autoComplete="off"
                value={value.street}
                maxLength={150}
                onChange={(e) => {
                  setTyping(true)
                  set({ street: e.target.value })
                }}
                onBlur={() => setTyping(false)}
              />
            </label>
            <label>
              Hausnummer
              <input value={value.house_no} maxLength={20} onChange={(e) => set({ house_no: e.target.value })} />
            </label>
          </div>
          <AddressSuggest
            active={typing}
            query={[`${value.street} ${value.house_no}`, `${value.zip} ${value.city}`].join(' ')}
            onPick={(a) => {
              setTyping(false)
              set({ ...a, house_no: a.house_no || value.house_no, country: a.country || value.country })
            }}
          />
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
          <CountryInput value={value.country} onChange={(country) => set({ country })} />
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
  customer_country: string
  customer_email: string
}

export const emptyCustomer: CustomerData = {
  customer_number: '',
  customer_name: '',
  customer_street: '',
  customer_house_no: '',
  customer_zip: '',
  customer_city: '',
  customer_country: DEFAULT_COUNTRY,
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
    customer_country: t.customer_country || DEFAULT_COUNTRY,
    customer_email: t.customer_email,
  }
}

export function customerColumns(c: CustomerData) {
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.trim()])) as unknown as CustomerData
}

export function CustomerFields({ value, onChange }: { value: CustomerData; onChange: (v: CustomerData) => void }) {
  const set = (patch: Partial<CustomerData>) => onChange({ ...value, ...patch })
  const [typing, setTyping] = useState(false)
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
          <input
            autoComplete="off"
            value={value.customer_street}
            maxLength={150}
            onChange={(e) => {
              setTyping(true)
              set({ customer_street: e.target.value })
            }}
            onBlur={() => setTyping(false)}
          />
        </label>
        <label>
          Hausnummer
          <input value={value.customer_house_no} maxLength={20} onChange={(e) => set({ customer_house_no: e.target.value })} />
        </label>
      </div>
      <AddressSuggest
        active={typing}
        query={`${value.customer_street} ${value.customer_house_no} ${value.customer_zip} ${value.customer_city}`}
        onPick={(a) => {
          setTyping(false)
          set({
            customer_street: a.street,
            customer_house_no: a.house_no || value.customer_house_no,
            customer_zip: a.zip,
            customer_city: a.city,
            customer_country: a.country || value.customer_country,
          })
        }}
      />
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
      <CountryInput value={value.customer_country} onChange={(customer_country) => set({ customer_country })} />
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

function CountryInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label>
      Land
      <input list="country-list" value={value} maxLength={60} onChange={(e) => onChange(e.target.value)} />
      <datalist id="country-list">
        {COUNTRY_LIST.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </label>
  )
}

// Für die Adressprüfung beim Speichern
export function addressesToCheck(c: CustomerData, jobsite: AltAddress, billing: AltAddress) {
  const list = [
    { label: 'Kundenadresse', street: c.customer_street, house_no: c.customer_house_no, zip: c.customer_zip, city: c.customer_city, country: c.customer_country },
  ]
  if (jobsite.different) list.push({ label: 'Baustellenadresse', ...jobsite })
  if (billing.different) list.push({ label: 'Rechnungsadresse', ...billing })
  return list
}
