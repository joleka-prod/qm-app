import { Link } from 'react-router-dom'
import { formatTime, ticketNo, type Ticket } from '../lib/types'
import { AreaBadge, TypeBadge } from './StatusBadge'

interface Props {
  ticket: Ticket
  draggable?: boolean
  showAddress?: boolean
}

// Ein Einsatz im Kalender. Planer können ihn per Ziehen auf einen anderen Tag/Monteur verschieben.
export function JobCard({ ticket: t, draggable, showAddress }: Props) {
  const done = t.status === 'abgeschlossen'
  return (
    <Link
      to={`/ticket/${t.id}`}
      className={`job job-${t.ticket_type} job-area-${t.service_area} ${done ? 'job-done' : ''}`}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/ticket-id', String(t.id))
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      <div className="job-top">
        <span className="job-tags">
          <AreaBadge area={t.service_area} />
          <TypeBadge type={t.ticket_type} />
        </span>
        <span className="job-meta">
          {done && '✓ '}
          {formatTime(t.montage_time) || ticketNo(t.id, t.ticket_type)}
        </span>
      </div>
      <div className="job-title">{t.title}</div>
      {t.customer_name && <div className="job-sub">{t.customer_name}</div>}
      {showAddress && t.site_address && <div className="job-sub pre">{t.site_address}</div>}
    </Link>
  )
}
