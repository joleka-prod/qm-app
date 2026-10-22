export type Role = 'mitarbeiter' | 'teamleiter' | 'admin'
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

export const ROLE_LABEL: Record<Role, string> = {
  mitarbeiter: 'Mitarbeiter',
  teamleiter: 'Teamleiter',
  admin: 'QM / Admin',
}

export function ticketNo(id: number) {
  return `QM-${String(id).padStart(4, '0')}`
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
