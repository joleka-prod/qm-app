import { AREA_LABEL, statusLabel, type AppointmentState, type BillingState, type ServiceArea, type TicketStatus, type TicketType } from '../lib/types'

export function StatusBadge({
  status,
  type = 'qm',
  appointment = 'offen',
  billing = 'keine',
}: {
  status: TicketStatus
  type?: TicketType
  appointment?: AppointmentState
  billing?: BillingState
}) {
  const termin = type !== 'qm' && status === 'zugewiesen' && appointment !== 'offen'
  const cls = termin ? `termin-${appointment}` : status === 'abgeschlossen' && billing !== 'keine' ? billing : status
  return <span className={`badge badge-${cls}`}>{statusLabel(type, status, appointment, billing)}</span>
}

export function TypeBadge({ type }: { type: TicketType }) {
  return <span className={`type-tag type-${type}`}>{({ qm: 'QM', montageauftrag: 'Montageauftrag', restarbeit: 'Restarbeit', beanstandung: 'Beanstandung', reparatur: 'Reparatur' })[type]}</span>
}

export function AreaBadge({ area }: { area: ServiceArea | null }) {
  if (!area) return null
  return <span className={`area-tag area-${area}`}>{AREA_LABEL[area]}</span>
}
