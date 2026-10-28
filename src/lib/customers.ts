import { supabase } from './supabase'
import type { CustomerData } from '../components/AddressFields'

export type CustomerGroup = 'privat' | 'bautraeger' | 'generalunternehmer' | 'architekt' | 'oeffentlich'
export type NoteKind = 'telefon' | 'email' | 'termin' | 'brief' | 'notiz'

export interface Customer {
  id: number
  customer_number: string
  customer_group: CustomerGroup
  name: string
  name2: string
  street: string
  house_no: string
  zip: string
  city: string
  country: string
  phone: string
  mobile: string
  email: string
  website: string
  notes: string
  origin: string
  active: boolean
  // '3e' = Stammdaten kommen aus 3E Look und sind in der App schreibgeschützt
  source: 'app' | '3e'
  ext_id: string | null
  synced_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CustomerContact {
  id: number
  customer_id: number
  name: string
  position: string
  phone: string
  mobile: string
  email: string
  notes: string
}

export interface CustomerNote {
  id: number
  customer_id: number
  contact_id: number | null
  ticket_id: number | null
  project_id: number | null
  kind: NoteKind
  subject: string
  body: string
  follow_up_date: string | null
  follow_up_user: string | null
  follow_up_done_at: string | null
  follow_up_done_by: string | null
  created_by: string | null
  created_at: string
  // nur bei automatisch zugeordneten E-Mails (sync-mail)
  mail_direction: 'eingang' | 'ausgang' | null
  mail_mailbox: string | null
  mail_from: string | null
  mail_to: string | null
  mail_attachments: string[]
}

export const GROUP_LABEL: Record<CustomerGroup, string> = {
  privat: 'Privatkunde',
  bautraeger: 'Bauträger',
  generalunternehmer: 'Generalunternehmer',
  architekt: 'Architekt',
  oeffentlich: 'Öffentlicher Auftraggeber',
}

export const GROUP_PLURAL: Record<CustomerGroup, string> = {
  privat: 'Privatkunden',
  bautraeger: 'Bauträger',
  generalunternehmer: 'Generalunternehmer',
  architekt: 'Architekten',
  oeffentlich: 'Öffentliche Auftraggeber',
}

export const CUSTOMER_GROUPS = Object.keys(GROUP_LABEL) as CustomerGroup[]

// Kundenherkunft wie in 3E (Klassifikation 1)
export const CUSTOMER_ORIGINS = [
  'Bestandskunde',
  'wiederkehrender Kunde',
  'Empfehlung',
  'Google Internetseite',
  'Social Media',
  'Printmedien',
  'Fahrzeugwerbung / Bauschild / Plakatwerbung',
  'über Mitarbeiter',
  'über Kundendienst',
  'Messen / Inhouseveranstaltung',
  'Profine Website',
]

export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  telefon: 'Telefonat',
  email: 'E-Mail',
  termin: 'Termin / Besuch',
  brief: 'Brief',
  notiz: 'Notiz',
}

export const NOTE_KINDS = Object.keys(NOTE_KIND_LABEL) as NoteKind[]

export function customerAddress(c: Pick<Customer, 'street' | 'house_no' | 'zip' | 'city' | 'country'>) {
  return [`${c.street} ${c.house_no}`.trim(), `${c.zip} ${c.city}`.trim(), c.country === 'Deutschland' ? '' : c.country]
    .filter(Boolean)
    .join(', ')
}

// Suche im Kundenstamm (Name, Zusatz, Kundennummer, Adresse, Kontakt) über die RPC, schnell auch bei über 20.000 Kunden
export async function searchCustomers(query: string, limit = 8) {
  const q = query.trim()
  if (q.length < 2) return []
  const { data } = await supabase.rpc('search_customers', { p_query: q, p_limit: limit })
  return ((data as { rows?: Customer[] } | null)?.rows ?? []) as Customer[]
}

// Beim Speichern eines Auftrags: unbekannten Kunden im Kundenstamm anlegen bzw. über die Kundennummer verknüpfen.
// Fehler blockieren den Auftrag nicht, er bleibt dann nur unverknüpft.
export async function ensureCustomer(c: CustomerData): Promise<CustomerData> {
  if (c.customer_id || !c.customer_name.trim()) return c
  const number = c.customer_number.trim()
  if (number) {
    const { data } = await supabase.from('customers').select('id').eq('customer_number', number).maybeSingle()
    if (data) return { ...c, customer_id: data.id as number }
  }
  const { data } = await supabase
    .from('customers')
    .insert({
      customer_number: number,
      name: c.customer_name.trim(),
      street: c.customer_street.trim(),
      house_no: c.customer_house_no.trim(),
      zip: c.customer_zip.trim(),
      city: c.customer_city.trim(),
      country: c.customer_country.trim(),
      email: c.customer_email.trim(),
      phone: c.customer_phone.trim(),
      mobile: c.customer_mobile.trim(),
    })
    .select('id, customer_number')
    .single()
  return data ? { ...c, customer_id: data.id as number, customer_number: data.customer_number as string } : c
}
