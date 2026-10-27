import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { GROUP_LABEL, searchCustomers, type Customer } from '../lib/customers'
import type { Ticket } from '../lib/types'
import { noAutofill } from '../lib/noAutofill'
import { AddressSuggest } from './AddressSuggest'

// Abweichende Adresse: Rechnungsadresse am Auftrag (billing_*) oder Adresse eines neuen Bauvorhabens.
// Die frühere Baustellenadresse (jobsite_*) wird nicht mehr erfasst, der Einsatzort ist das Bauvorhaben (Fabian, 2026-10-27).
export type AddressKind = 'billing' | 'project'

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

// Wo der Einsatz stattfindet: Adresse des Bauvorhabens, sonst Kundenadresse (mehrzeilig, wie in calc-distance)
export function jobAddress(t: Pick<Ticket, 'project' | 'site_address'>) {
  const p = t.project
  if (!p || !`${p.street ?? ''}${p.zip}${p.city}`.trim()) return t.site_address.trim()
  return [`${p.street ?? ''} ${p.house_no ?? ''}`.trim(), `${p.zip} ${p.city}`.trim(), !p.country || p.country === DEFAULT_COUNTRY ? '' : p.country]
    .filter(Boolean)
    .join('\n')
}

const TITLE: Record<AddressKind, string> = { billing: 'Rechnungsadresse', project: 'Adresse des Bauvorhabens' }
const TOGGLE: Record<AddressKind, string> = { billing: 'Abweichende Rechnungsadresse', project: 'Bauvorhaben liegt nicht an der Kundenadresse' }

export function AddressFields({ kind, value, onChange }: { kind: AddressKind; value: AltAddress; onChange: (v: AltAddress) => void }) {
  const set = (patch: Partial<AltAddress>) => onChange({ ...value, ...patch })
  const [typing, setTyping] = useState(false)
  return (
    <>
      <label className="checkbox-row">
        <input type="checkbox" checked={value.different} onChange={(e) => set({ different: e.target.checked })} />
        {TOGGLE[kind]}
      </label>
      {value.different && (
        <fieldset className="billing-address">
          <legend>{TITLE[kind]}</legend>
          {kind === 'billing' && (
            <label>
              Name *
              <input required {...noAutofill(`${kind}-name`)} value={value.name} maxLength={150} onChange={(e) => set({ name: e.target.value })} />
            </label>
          )}
          <div className="row street-row">
            <label>
              Straße *
              <input
                required
                {...noAutofill(`${kind}-street`)}
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
              <input {...noAutofill(`${kind}-house-no`)} value={value.house_no} maxLength={20} onChange={(e) => set({ house_no: e.target.value })} />
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
              <input required inputMode="numeric" {...noAutofill(`${kind}-zip`)} value={value.zip} maxLength={10} onChange={(e) => set({ zip: e.target.value })} />
            </label>
            <label>
              Ort *
              <input required {...noAutofill(`${kind}-city`)} value={value.city} maxLength={100} onChange={(e) => set({ city: e.target.value })} />
            </label>
          </div>
          <CountryInput field={`${kind}-country`} value={value.country} onChange={(country) => set({ country })} />
        </fieldset>
      )}
    </>
  )
}

// Kundendaten: Kundennummer zuerst, Adresse in Feldern wie bei der Rechnungsadresse
export interface CustomerData {
  // Verknüpfung mit dem Kundenstamm (null = noch nicht verknüpft)
  customer_id: number | null
  customer_number: string
  customer_name: string
  customer_street: string
  customer_house_no: string
  customer_zip: string
  customer_city: string
  customer_country: string
  customer_email: string
  customer_phone: string
  customer_mobile: string
}

export const emptyCustomer: CustomerData = {
  customer_id: null,
  customer_number: '',
  customer_name: '',
  customer_street: '',
  customer_house_no: '',
  customer_zip: '',
  customer_city: '',
  customer_country: DEFAULT_COUNTRY,
  customer_email: '',
  customer_phone: '',
  customer_mobile: '',
}

export function customerOf(t: Ticket): CustomerData {
  return {
    customer_id: t.customer_id,
    customer_number: t.customer_number,
    customer_name: t.customer_name,
    customer_street: t.customer_street,
    customer_house_no: t.customer_house_no,
    customer_zip: t.customer_zip,
    customer_city: t.customer_city,
    customer_country: t.customer_country || DEFAULT_COUNTRY,
    customer_email: t.customer_email,
    customer_phone: t.customer_phone ?? '',
    customer_mobile: t.customer_mobile ?? '',
  }
}

// customer_id und Telefonnummern nur mitschicken, wenn gefüllt (Leeren schickt der Aufrufer selbst, siehe customerClears)
export function customerColumns(c: CustomerData) {
  const { customer_id, ...rest } = c
  const row: Record<string, string | number> = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v.trim()]))
  if (!row.customer_phone) delete row.customer_phone
  if (!row.customer_mobile) delete row.customer_mobile
  if (customer_id) row.customer_id = customer_id
  return row
}

// Felder, die beim Bearbeiten geleert wurden
export function customerClears(before: CustomerData, after: CustomerData) {
  const clear: Record<string, null | string> = {}
  if (before.customer_id && !after.customer_id) clear.customer_id = null
  if (before.customer_phone && !after.customer_phone.trim()) clear.customer_phone = ''
  if (before.customer_mobile && !after.customer_mobile.trim()) clear.customer_mobile = ''
  return clear
}

// Daten eines Kunden aus dem Kundenstamm in den Auftrag übernehmen
export function customerFromMaster(c: Customer): CustomerData {
  return {
    customer_id: c.id,
    customer_number: c.customer_number,
    customer_name: [c.name, c.name2].filter(Boolean).join(' '),
    customer_street: c.street,
    customer_house_no: c.house_no,
    customer_zip: c.zip,
    customer_city: c.city,
    customer_country: c.country || DEFAULT_COUNTRY,
    customer_email: c.email,
    customer_phone: c.phone,
    customer_mobile: c.mobile,
  }
}

// crm: Kunden aus dem Kundenstamm suchen und verknüpfen
export function CustomerFields({ value, onChange, crm }: { value: CustomerData; onChange: (v: CustomerData) => void; crm?: boolean }) {
  const set = (patch: Partial<CustomerData>) => onChange({ ...value, ...patch })
  const [typing, setTyping] = useState(false)
  const [typingName, setTypingName] = useState(false)
  const [matches, setMatches] = useState<Customer[]>([])
  // Verknüpfte Kunden werden eingeklappt angezeigt
  const [expanded, setExpanded] = useState(!value.customer_id)
  // Kunde von außen gesetzt (z. B. /neu?kunde=…): einklappen
  useEffect(() => {
    if (value.customer_id) setExpanded(false)
  }, [value.customer_id])
  const searchText = crm && typingName && !value.customer_id ? `${value.customer_number || value.customer_name}` : ''

  useEffect(() => {
    if (searchText.trim().length < 2) {
      setMatches([])
      return
    }
    let stale = false
    const t = setTimeout(async () => {
      const found = await searchCustomers(searchText)
      if (!stale) setMatches(found)
    }, 250)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [searchText])

  const pick = (c: Customer) => {
    setTypingName(false)
    setMatches([])
    setExpanded(false)
    onChange(customerFromMaster(c))
  }

  const suggestions = matches.length > 0 && (
    <ul className="address-suggest" role="listbox" aria-label="Kunden aus dem Kundenstamm">
      {matches.map((c) => (
        <li key={c.id}>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)}>
            <strong>{c.customer_number}</strong> {c.name} {c.name2}
            <span className="muted small"> · {GROUP_LABEL[c.customer_group]}{c.city && ` · ${c.zip} ${c.city}`}</span>
          </button>
        </li>
      ))}
    </ul>
  )

  const linked = crm && !!value.customer_id
  const summary = [`${value.customer_street} ${value.customer_house_no}`.trim(), `${value.customer_zip} ${value.customer_city}`.trim(),
    value.customer_country === DEFAULT_COUNTRY ? '' : value.customer_country].filter(Boolean).join(', ')

  // Aus dem Kundenstamm übernommen: kompakte Zusammenfassung statt Eingabefelder
  if (linked && !expanded) {
    return (
      <fieldset className="billing-address customer-box">
        <legend>Kunde</legend>
        <div className="customer-summary">
          <div>
            <Link to={`/kunden/${value.customer_id}`} className="customer-summary-name">
              {value.customer_number} · {value.customer_name}
            </Link>
            {summary && <div className="small">{summary}</div>}
            {(value.customer_phone || value.customer_mobile || value.customer_email) && (
              <div className="small muted">
                {[value.customer_phone && `☎ ${value.customer_phone}`, value.customer_mobile && `📱 ${value.customer_mobile}`, value.customer_email]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            )}
          </div>
          <div className="customer-summary-actions">
            <button type="button" className="link" onClick={() => setExpanded(true)}>Ändern</button>
            <button type="button" className="link" onClick={() => { onChange(emptyCustomer); setExpanded(true) }}>Anderer Kunde</button>
          </div>
        </div>
      </fieldset>
    )
  }

  return (
    <fieldset className="billing-address customer-box">
      <legend>Kunde</legend>
      <div className="row cust-name-row">
        <label>
          Kundennr.
          <input
            value={value.customer_number}
            maxLength={30}
            {...noAutofill('customer-number')}
            onChange={(e) => {
              setTypingName(true)
              set({ customer_number: e.target.value })
            }}
            onBlur={() => setTypingName(false)}
          />
        </label>
        <label>
          Name
          <input
            value={value.customer_name}
            maxLength={150}
            {...noAutofill('customer-name')}
            placeholder={crm && !linked ? 'Tippen für Vorschläge aus dem Kundenstamm' : ''}
            onChange={(e) => {
              setTypingName(true)
              set({ customer_name: e.target.value })
            }}
            onBlur={() => setTypingName(false)}
          />
        </label>
      </div>
      {suggestions}
      <div className="row street-row">
        <label>
          Straße
          <input
            {...noAutofill('customer-street')}
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
          Nr.
          <input {...noAutofill('customer-house-no')} value={value.customer_house_no} maxLength={20} onChange={(e) => set({ customer_house_no: e.target.value })} />
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
      <div className="row cust-place-row">
        <label>
          PLZ
          <input inputMode="numeric" {...noAutofill('customer-zip')} value={value.customer_zip} maxLength={10} onChange={(e) => set({ customer_zip: e.target.value })} />
        </label>
        <label>
          Ort
          <input {...noAutofill('customer-city')} value={value.customer_city} maxLength={100} onChange={(e) => set({ customer_city: e.target.value })} />
        </label>
        <CountryInput field="customer-country" value={value.customer_country} onChange={(customer_country) => set({ customer_country })} />
      </div>
      <div className="row">
        <label>
          Telefon
          <input type="tel" {...noAutofill('customer-phone')} value={value.customer_phone} maxLength={50} onChange={(e) => set({ customer_phone: e.target.value })} />
        </label>
        <label>
          Mobil
          <input type="tel" {...noAutofill('customer-mobile')} value={value.customer_mobile} maxLength={50} onChange={(e) => set({ customer_mobile: e.target.value })} />
        </label>
      </div>
      <label>
        E-Mail
        <input
          type="email"
          inputMode="email"
          {...noAutofill('customer-email')}
          value={value.customer_email}
          maxLength={200}
          onChange={(e) => set({ customer_email: e.target.value })}
          placeholder="name@beispiel.de"
        />
      </label>
      {linked && (
        <p className="small muted customer-link">
          Aus <Link to={`/kunden/${value.customer_id}`}>Kundenakte {value.customer_number}</Link>; Änderungen gelten nur für diesen Auftrag.{' '}
          <button type="button" className="link" onClick={() => setExpanded(false)}>Einklappen</button>
        </p>
      )}
    </fieldset>
  )
}

function CountryInput({ field, value, onChange }: { field: string; value: string; onChange: (v: string) => void }) {
  return (
    <label>
      Land
      <input list="country-list" {...noAutofill(field)} value={value} maxLength={60} onChange={(e) => onChange(e.target.value)} />
      <datalist id="country-list">
        {COUNTRY_LIST.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </label>
  )
}

// Für die Adressprüfung beim Speichern
export function addressesToCheck(c: CustomerData, project: AltAddress, billing: AltAddress) {
  const list = [
    { label: 'Kundenadresse', street: c.customer_street, house_no: c.customer_house_no, zip: c.customer_zip, city: c.customer_city, country: c.customer_country },
  ]
  if (project.different) list.push({ label: 'Adresse des Bauvorhabens', ...project })
  if (billing.different) list.push({ label: 'Rechnungsadresse', ...billing })
  return list
}
