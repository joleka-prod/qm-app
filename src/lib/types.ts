export type Role = 'mitarbeiter' | 'teamleiter' | 'disposition' | 'monteur' | 'admin'
export type TicketType = 'qm' | 'restarbeit' | 'beanstandung' | 'reparatur'
export type ServiceArea = 'kundendienst' | 'montage'
export type TicketStatus = 'neu' | 'zugewiesen' | 'in_bearbeitung' | 'zur_pruefung' | 'abgeschlossen'
export type AppointmentState = 'offen' | 'angemeldet' | 'bestaetigt'
export type BillingState = 'keine' | 'zur_berechnung' | 'berechnet'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: Role
  active: boolean
  supervisor_id: string | null
  vacation_days: number
  weekly_hours: number
  overtime_start: string
  overtime_opening: number
  created_at: string
}

export interface Ticket {
  id: number
  title: string
  description: string
  order_number: string
  position_number: string
  ticket_type: TicketType
  installer_id: string | null
  team_id: number | null
  montage_date: string | null
  montage_time: string | null
  customer_name: string
  customer_email: string
  report_by_email: boolean
  report_sent_at: string | null
  report_send_error: string
  parent_id: number | null
  distance_km: number | null
  distance_address: string
  distance_error: string
  customer_number: string
  customer_street: string
  customer_house_no: string
  customer_zip: string
  customer_city: string
  customer_country: string
  billing_address_different: boolean
  billing_name: string
  billing_street: string
  billing_house_no: string
  billing_zip: string
  billing_city: string
  billing_country: string
  jobsite_address_different: boolean
  jobsite_name: string
  jobsite_street: string
  jobsite_house_no: string
  jobsite_zip: string
  jobsite_city: string
  jobsite_country: string
  site_address: string
  work_report: string
  service_area: ServiceArea | null
  signature_path: string | null
  signer_name: string
  signed_at: string | null
  appointment_state: AppointmentState
  billing_state: BillingState
  billed_at: string | null
  billed_by: string | null
  appointment_date: string | null
  appointment_time: string | null
  appointment_told_by: string | null
  appointment_announced_by: string | null
  appointment_announced_at: string | null
  appointment_note: string
  appointment_confirmed_by: string | null
  appointment_confirmed_at: string | null
  // nur gefüllt, wenn mit select('*, ticket_positions(count)') geladen
  ticket_positions?: { count: number }[]
  time_entries?: { started_at: string; ended_at: string | null }[]
  status: TicketStatus
  created_by: string
  assigned_to: string | null
  cause: string
  corrective_action: string
  review_note: string
  created_at: string
  updated_at: string
  closed_at: string | null
}

export interface TicketPhoto {
  id: number
  ticket_id: number
  position_id: number | null
  storage_path: string
  uploaded_by: string
  created_at: string
}

export type PositionState = 'offen' | 'erledigt' | 'nicht_erledigt'

export interface TicketPosition {
  id: number
  ticket_id: number
  sort: number
  position_number: string
  description: string
  state: PositionState
  reason: string
  price: number | null
  quantity: number
  unit: string
  article_id: number | null
  done_by: string | null
  done_at: string | null
}

export interface DeletionRequest {
  ticket_id: number
  requested_by: string
  reason: string
  created_at: string
}

export interface TicketEvent {
  id: number
  ticket_id: number
  actor: string | null
  kind: string
  details: string
  created_at: string
}

export const STATUS_LABEL: Record<TicketStatus, string> = {
  neu: 'Neu',
  zugewiesen: 'Zugewiesen',
  in_bearbeitung: 'In Bearbeitung',
  zur_pruefung: 'Zur Prüfung',
  abgeschlossen: 'Abgeschlossen',
}

// Einsätze (Restarbeit, Beanstandung, Reparatur) nutzen nur neu / zugewiesen / abgeschlossen
const EINSATZ_STATUS_LABEL: Partial<Record<TicketStatus, string>> = {
  neu: 'Ungeplant',
  zugewiesen: 'Geplant',
  abgeschlossen: 'Erledigt',
}

export const APPOINTMENT_LABEL: Record<Exclude<AppointmentState, 'offen'>, string> = {
  angemeldet: 'Termin bei Kunde angemeldet',
  bestaetigt: 'Termin von Kunde bestätigt',
}

export const BILLING_LABEL: Record<Exclude<BillingState, 'keine'>, string> = {
  zur_berechnung: 'Zur Berechnung',
  berechnet: 'Berechnet',
}

// Ein geplanter Einsatz zeigt, wie weit der Termin mit dem Kunden abgestimmt ist,
// ein erledigter Reparaturauftrag den Stand der Berechnung
export function statusLabel(
  type: TicketType,
  status: TicketStatus,
  appointment: AppointmentState = 'offen',
  billing: BillingState = 'keine',
) {
  if (type !== 'qm' && status === 'zugewiesen' && appointment !== 'offen') return APPOINTMENT_LABEL[appointment]
  if (status === 'abgeschlossen' && billing !== 'keine') return BILLING_LABEL[billing]
  return (type !== 'qm' && EINSATZ_STATUS_LABEL[status]) || STATUS_LABEL[status]
}

export const TYPE_LABEL: Record<TicketType, string> = {
  qm: 'QM-Ticket',
  restarbeit: 'Restarbeit',
  beanstandung: 'Beanstandung',
  reparatur: 'Reparaturauftrag',
}

const TYPE_PREFIX: Record<TicketType, string> = {
  qm: 'QM',
  restarbeit: 'RA',
  beanstandung: 'BE',
  reparatur: 'RP',
}

export const AREA_LABEL: Record<ServiceArea, string> = {
  kundendienst: 'Kundendienst',
  montage: 'Montage',
}

export const SERVICE_AREAS = Object.keys(AREA_LABEL) as ServiceArea[]

export function defaultArea(type: TicketType): ServiceArea {
  return type === 'restarbeit' ? 'montage' : 'kundendienst'
}

// QM-Tickets gibt es nicht mehr (2026-10-24); der Typ bleibt nur für alte Daten in der Datenbank
export const TICKET_TYPES: TicketType[] = (Object.keys(TYPE_LABEL) as TicketType[]).filter((t) => t !== 'qm')

export function isEinsatz(t: Pick<Ticket, 'ticket_type'>) {
  return t.ticket_type !== 'qm'
}

export const ROLE_LABEL: Record<Role, string> = {
  mitarbeiter: 'Mitarbeiter',
  teamleiter: 'Teamleiter',
  disposition: 'Disposition',
  monteur: 'Monteur',
  admin: 'Admin',
}

// Planen Service-Aufträge (Kalender, Teams, Termine, Zeiterfassung, Berechnung)
export function isPlannerRole(role: Role | undefined | null) {
  return role === 'admin' || role === 'teamleiter' || role === 'disposition'
}

export function ticketNo(id: number, type: TicketType = 'qm') {
  return `${TYPE_PREFIX[type]}-${String(id).padStart(4, '0')}`
}

export function isEmail(s: string) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim())
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function orderRef(t: Pick<Ticket, 'order_number' | 'position_number'>) {
  const parts = []
  if (t.order_number) parts.push(`Auftrag ${t.order_number}`)
  if (t.position_number) parts.push(`Pos. ${t.position_number}`)
  return parts.join(' · ')
}

export function displayName(p: Pick<Profile, 'full_name' | 'email'> | undefined | null) {
  if (!p) return '–'
  return p.full_name.trim() || p.email
}

// --- Datumshilfen (lokale Zeit, Format YYYY-MM-DD wie in Postgres "date") ---

export function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function parseDate(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(d: Date, n: number) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export function startOfWeek(d: Date) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7))
  return r
}

export function formatDay(s: string) {
  return parseDate(s).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function formatTime(t: string | null) {
  return t ? t.slice(0, 5) : ''
}

export function weekNumber(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

// Warnung, wenn ein dem Kunden schon mitgeteilter Termin verschoben werden soll
export function appointmentMoveWarning(
  t: Pick<Ticket, 'status' | 'appointment_state' | 'appointment_date' | 'appointment_time' | 'montage_date' | 'montage_time'>,
  date: string | null,
  time: string | null,
  toldBy?: string,
) {
  if (t.status === 'abgeschlossen' || t.appointment_state === 'offen') return null
  if (date === t.montage_date && formatTime(time) === formatTime(t.montage_time)) return null
  const when = `${t.appointment_date ? formatDay(t.appointment_date) : ''}${t.appointment_time ? ` um ${formatTime(t.appointment_time)} Uhr` : ''}`
  const was = t.appointment_state === 'bestaetigt' ? 'mitgeteilt und vom Kunden bestätigt' : 'mitgeteilt'
  return (
    `Achtung: Dem Kunden wurde bereits der Termin ${when} ${was}${toldBy ? ` (durch ${toldBy})` : ''}.\n\n` +
    `Wenn du den Termin änderst, wird die Anmeldung aufgehoben und der Kunde muss über den neuen Termin informiert werden.\n\nTrotzdem ändern?`
  )
}

export function formatEuro(n: number | null | undefined) {
  return n == null ? '–' : n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
}

// Vorschläge für Mengeneinheiten (frei ergänzbar)
export const UNITS = ['Stk', 'Std.', 'Lfm.', 'm', 'm²', 'km', 'pauschal']
export const UNIT_HINT: Record<string, string> = { Stk: 'Stück', 'Std.': 'Stunden', 'Lfm.': 'Laufmeter', m: 'Meter', 'm²': 'Quadratmeter', km: 'Kilometer', pauschal: 'Pauschal' }
