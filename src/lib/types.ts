export type Role = 'mitarbeiter' | 'teamleiter' | 'monteur' | 'admin'
export type TicketType = 'qm' | 'restarbeit' | 'beanstandung' | 'reparatur'
export type TicketStatus = 'neu' | 'zugewiesen' | 'in_bearbeitung' | 'zur_pruefung' | 'abgeschlossen'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: Role
  active: boolean
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
  montage_date: string | null
  montage_time: string | null
  customer_name: string
  site_address: string
  work_report: string
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
  storage_path: string
  uploaded_by: string
  created_at: string
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

export function statusLabel(type: TicketType, status: TicketStatus) {
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

export const TICKET_TYPES = Object.keys(TYPE_LABEL) as TicketType[]

export function isEinsatz(t: Pick<Ticket, 'ticket_type'>) {
  return t.ticket_type !== 'qm'
}

export const ROLE_LABEL: Record<Role, string> = {
  mitarbeiter: 'Mitarbeiter',
  teamleiter: 'Teamleiter',
  monteur: 'Monteur',
  admin: 'QM / Admin',
}

export function ticketNo(id: number, type: TicketType = 'qm') {
  return `${TYPE_PREFIX[type]}-${String(id).padStart(4, '0')}`
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
