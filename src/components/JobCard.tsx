import { Link } from 'react-router-dom'
import { formatHours, formatManDays, formatTime, manDays, projectPlace, ticketNo, weekLabel, type Ticket } from '../lib/types'
import { jobAddress } from './AddressFields'
import { AreaBadge, TypeBadge } from './StatusBadge'

interface Props {
  ticket: Ticket
  draggable?: boolean
  showAddress?: boolean
  // Grobplanung (Vorplanung) anzeigen
  showWeek?: boolean
  // Vorplanung: kalkulierte Montagezeit in Stunden statt Manntagen
  hoursPerManDay?: number
}

// Ein Einsatz im Kalender. Planer können ihn per Ziehen auf einen anderen Tag/Monteur verschieben.
export function JobCard({ ticket: t, draggable, showAddress, showWeek, hoursPerManDay }: Props) {
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
      {projectPlace(t) && <div className="job-place">📍 {projectPlace(t)}</div>}
      {!done && t.appointment_state !== 'offen' && (
        <div className={`job-termin job-termin-${t.appointment_state}`}>
          {t.appointment_state === 'bestaetigt' ? '✓ Kunde hat bestätigt' : '☎ beim Kunden angemeldet'}
        </div>
      )}
      {showWeek && t.planned_week && <div className="job-week">Vorgemerkt {weekLabel(t.planned_week)}</div>}
      {t.customer_name && <div className="job-sub">{t.customer_name}</div>}
      {!!manDays(t.calc_men, t.calc_days) && (
        <div className="job-sub">
          {t.calc_men} Mann × {Number(t.calc_days).toLocaleString('de-DE')} Tage ={' '}
          {hoursPerManDay
            ? formatHours(manDays(t.calc_men, Number(t.calc_days))! * hoursPerManDay)
            : formatManDays(manDays(t.calc_men, Number(t.calc_days))!)}
        </div>
      )}
      {!!t.ticket_positions?.[0]?.count && <div className="job-sub">{t.ticket_positions[0].count} Pos.</div>}
      {showAddress && jobAddress(t) && <div className="job-sub pre">{jobAddress(t)}</div>}
    </Link>
  )
}
