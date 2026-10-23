import { AREA_LABEL, statusLabel, type AppointmentState, type ServiceArea, type TicketStatus, type TicketType } from '../lib/types'

export function StatusBadge({
  status,
  type = 'qm',
  appointment = 'offen',
}: {
  status: TicketStatus
  type?: TicketType
  appointment?: AppointmentState
}) {
  const termin = type !== 'qm' && status === 'zugewiesen' && appointment !== 'offen'
  return <span className={`badge badge-${termin ? `termin-${appointment}` : status}`}>{statusLabel(type, status, appointment)}</span>
}

export function TypeBadge({ type }: { type: TicketType }) {
  return <span className={`type-tag type-${type}`}>{({ qm: 'QM', restarbeit: 'Restarbeit', beanstandung: 'Beanstandung', reparatur: 'Reparatur' })[type]}</span>
}

export function AreaBadge({ area }: { area: ServiceArea | null }) {
  if (!area) return null
  return <span className={`area-tag area-${area}`}>{AREA_LABEL[area]}</span>
}
