import { AREA_LABEL, statusLabel, type ServiceArea, type TicketStatus, type TicketType } from '../lib/types'

export function StatusBadge({ status, type = 'qm' }: { status: TicketStatus; type?: TicketType }) {
  return <span className={`badge badge-${status}`}>{statusLabel(type, status)}</span>
}

export function TypeBadge({ type }: { type: TicketType }) {
  return <span className={`type-tag type-${type}`}>{({ qm: 'QM', restarbeit: 'Restarbeit', beanstandung: 'Beanstandung', reparatur: 'Reparatur' })[type]}</span>
}

export function AreaBadge({ area }: { area: ServiceArea | null }) {
  if (!area) return null
  return <span className={`area-tag area-${area}`}>{AREA_LABEL[area]}</span>
}
