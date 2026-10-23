import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { PhotoGallery } from '../components/PhotoGallery'
import { PhotoPicker } from '../components/PhotoPicker'
import { StatusBadge, TypeBadge } from '../components/StatusBadge'
import { deletePhoto, uploadPhotos } from '../lib/photos'
import { supabase } from '../lib/supabase'
import {
  TYPE_LABEL,
  displayName,
  formatDate,
  formatDay,
  formatTime,
  isEinsatz,
  orderRef,
  statusLabel,
  ticketNo,
  type DeletionRequest,
  type Ticket,
  type TicketEvent,
  type TicketPhoto,
  type TicketStatus,
} from '../lib/types'
import { useProfiles } from '../lib/useProfiles'

const EVENT_LABEL: Record<string, string> = {
  erstellt: 'Erstellt',
  eingeplant: 'Eingeplant:',
  bericht: 'Arbeitsbericht bearbeitet',
  zugewiesen: 'Zugewiesen an',
  ursache: 'Ursache bearbeitet',
  massnahme: 'Maßnahme bearbeitet',
  auftrag: 'Auftrag/Position geändert:',
  status: 'Status geändert auf',
  pruefhinweis: 'Prüfhinweis',
  loeschantrag: 'Löschung beantragt:',
  loeschantrag_zurueck: 'Löschantrag zurückgezogen',
  loeschantrag_abgelehnt: 'Löschantrag abgelehnt',
}

export function TicketDetail() {
  const { id } = useParams()
  const ticketId = Number(id)
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { byId, leads, installers } = useProfiles()

  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [photos, setPhotos] = useState<TicketPhoto[]>([])
  const [events, setEvents] = useState<TicketEvent[]>([])
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [cause, setCause] = useState('')
  const [action, setAction] = useState('')
  const [reviewNote, setReviewNote] = useState('')
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [editing, setEditing] = useState(false)
  const [deletion, setDeletion] = useState<DeletionRequest | null>(null)
  const [requestingDeletion, setRequestingDeletion] = useState(false)
  const [deletionReason, setDeletionReason] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [orderNumber, setOrderNumber] = useState('')
  const [positionNumber, setPositionNumber] = useState('')
  const [customer, setCustomer] = useState('')
  const [address, setAddress] = useState('')
  const [installer, setInstaller] = useState('')
  const [montageDate, setMontageDate] = useState('')
  const [montageTime, setMontageTime] = useState('')
  const [report, setReport] = useState('')

  const load = useCallback(async () => {
    const [t, p, e, d] = await Promise.all([
      supabase.from('tickets').select('*').eq('id', ticketId).maybeSingle(),
      supabase.from('ticket_photos').select('*').eq('ticket_id', ticketId).order('created_at'),
      supabase.from('ticket_events').select('*').eq('ticket_id', ticketId).order('created_at'),
      supabase.from('deletion_requests').select('*').eq('ticket_id', ticketId).maybeSingle(),
    ])
    if (!t.data) {
      setNotFound(true)
      return
    }
    const tk = t.data as Ticket
    setTicket(tk)
    setCause(tk.cause)
    setAction(tk.corrective_action)
    setTitle(tk.title)
    setDescription(tk.description)
    setOrderNumber(tk.order_number)
    setPositionNumber(tk.position_number)
    setCustomer(tk.customer_name)
    setAddress(tk.site_address)
    setInstaller(tk.installer_id ?? '')
    setMontageDate(tk.montage_date ?? '')
    setMontageTime(formatTime(tk.montage_time))
    setReport(tk.work_report)
    setPhotos((p.data ?? []) as TicketPhoto[])
    setEvents((e.data ?? []) as TicketEvent[])
    setDeletion(d.data as DeletionRequest | null)
  }, [ticketId])

  useEffect(() => {
    load()
  }, [load])

  if (notFound) return <p>Ticket nicht gefunden. <Link to="/">Zur Übersicht</Link></p>
  if (!ticket || !profile) return <p className="muted">Lädt…</p>

  const isAdmin = profile.role === 'admin'
  const isLead = ticket.assigned_to === profile.id
  const closed = ticket.status === 'abgeschlossen'
  const canWork = !closed && (isLead || isAdmin) && ticket.assigned_to !== null
  const einsatz = isEinsatz(ticket)
  const isPlanner = isAdmin || profile.role === 'teamleiter'
  const isInstaller = ticket.installer_id === profile.id
  const canPlan = einsatz && isPlanner && !closed
  const canEditBase =
    isAdmin || (einsatz && isPlanner && !closed) || (ticket.created_by === profile.id && ticket.status === 'neu')
  const canRequestDeletion = ticket.created_by === profile.id || isLead || profile.role === 'teamleiter'
  const canEditRef = canEditBase || (isLead && !closed)
  const planDirty =
    installer !== (ticket.installer_id ?? '') ||
    montageDate !== (ticket.montage_date ?? '') ||
    montageTime !== formatTime(ticket.montage_time)
  const dirty = cause !== ticket.cause || action !== ticket.corrective_action

  async function update(patch: Partial<Ticket>) {
    setBusy(true)
    setError('')
    const { error } = await supabase.from('tickets').update(patch).eq('id', ticketId)
    if (error) setError(error.message)
    await load()
    setBusy(false)
    return !error
  }

  async function addPhotos() {
    setBusy(true)
    setError('')
    try {
      await uploadPhotos(ticketId, newFiles)
      setNewFiles([])
    } catch (err) {
      setError((err as Error).message)
    }
    await load()
    setBusy(false)
  }

  async function removePhoto(p: TicketPhoto) {
    try {
      await deletePhoto(p.id, p.storage_path)
    } catch (err) {
      setError((err as Error).message)
    }
    await load()
  }

  async function requestDeletion() {
    setBusy(true)
    setError('')
    const { error } = await supabase
      .from('deletion_requests')
      .insert({ ticket_id: ticketId, reason: deletionReason.trim() })
    if (error) setError(error.message)
    else {
      setRequestingDeletion(false)
      setDeletionReason('')
    }
    await load()
    setBusy(false)
  }

  async function dropDeletionRequest() {
    setBusy(true)
    setError('')
    const { error } = await supabase.from('deletion_requests').delete().eq('ticket_id', ticketId)
    if (error) setError(error.message)
    await load()
    setBusy(false)
  }

  async function removeTicket() {
    if (!confirm('Ticket mit allen Fotos endgültig löschen? Das kann nicht rückgängig gemacht werden.')) return
    if (photos.length > 0) {
      await supabase.storage.from('ticket-photos').remove(photos.map((p) => p.storage_path))
    }
    const { error } = await supabase.from('tickets').delete().eq('id', ticketId)
    if (error) setError(error.message)
    else navigate('/', { replace: true })
  }

  return (
    <div className="detail">
      <Link to="/" className="back">← Übersicht</Link>

      <section className="card">
        <div className="ticket-row-top">
          <span className="ticket-no">
            {ticketNo(ticket.id, ticket.ticket_type)} <TypeBadge type={ticket.ticket_type} />
          </span>
          <StatusBadge status={ticket.status} type={ticket.ticket_type} />
        </div>
        {editing ? (
          <div className="form">
            {canEditBase && (
              <label>
                Kurzbeschreibung
                <input value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} />
              </label>
            )}
            <div className="row">
              <label>
                Auftragsnummer
                <input value={orderNumber} maxLength={50} onChange={(e) => setOrderNumber(e.target.value)} />
              </label>
              <label>
                Positionsnummer
                <input value={positionNumber} maxLength={20} onChange={(e) => setPositionNumber(e.target.value)} />
              </label>
            </div>
            {einsatz && canEditBase && (
              <>
                <label>
                  Kunde
                  <input value={customer} maxLength={150} onChange={(e) => setCustomer(e.target.value)} />
                </label>
                <label>
                  Einsatzort / Adresse
                  <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
                </label>
              </>
            )}
            {canEditBase && (
              <label>
                Beschreibung
                <textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>
            )}
            <div className="actions">
              <button
                onClick={() => {
                  setEditing(false)
                  setTitle(ticket.title)
                  setDescription(ticket.description)
                  setOrderNumber(ticket.order_number)
                  setPositionNumber(ticket.position_number)
                  setCustomer(ticket.customer_name)
                  setAddress(ticket.site_address)
                }}
              >
                Abbrechen
              </button>
              <button
                className="primary"
                disabled={busy || !title.trim()}
                onClick={async () => {
                  const ref = { order_number: orderNumber.trim(), position_number: positionNumber.trim() }
                  const base = { ...ref, title: title.trim(), description: description.trim() }
                  const site = einsatz ? { customer_name: customer.trim(), site_address: address.trim() } : {}
                  const patch = canEditBase ? { ...base, ...site } : ref
                  if (await update(patch)) setEditing(false)
                }}
              >
                Speichern
              </button>
            </div>
          </div>
        ) : (
          <>
            <h1 className="ticket-heading">{ticket.title}</h1>
            {orderRef(ticket) && <p className="order-ref">{orderRef(ticket)}</p>}
            {einsatz && (ticket.customer_name || ticket.site_address) && (
              <p className="site">
                {ticket.customer_name && <strong>{ticket.customer_name}</strong>}
                {ticket.site_address && (
                  <>
                    {ticket.customer_name && <br />}
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ticket.site_address)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="pre"
                    >
                      {ticket.site_address}
                    </a>
                  </>
                )}
              </p>
            )}
            <p className="muted small">
              Erstellt {formatDate(ticket.created_at)} von {displayName(byId[ticket.created_by])}
              {ticket.closed_at && <> · {einsatz ? 'Erledigt' : 'Abgeschlossen'} {formatDate(ticket.closed_at)}</>}
            </p>
            {ticket.description ? <p className="pre">{ticket.description}</p> : <p className="muted">Keine Beschreibung.</p>}
            {canEditRef && (
              <button className="link" onClick={() => setEditing(true)}>
                {canEditBase ? 'Bearbeiten' : 'Auftrag/Position bearbeiten'}
              </button>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2>Fotos</h2>
        <PhotoGallery
          photos={photos}
          canDelete={(p) => isAdmin || (p.uploaded_by === profile.id && !closed)}
          onDelete={removePhoto}
        />
        {!closed && (
          <div className="add-photos">
            <PhotoPicker files={newFiles} onChange={setNewFiles} />
            {newFiles.length > 0 && (
              <button className="primary" disabled={busy} onClick={addPhotos}>
                {busy ? 'Lädt hoch…' : `${newFiles.length} Foto(s) hochladen`}
              </button>
            )}
          </div>
        )}
      </section>

      {einsatz && (
        <section className="card">
          <h2>Einsatzplanung</h2>
          {canPlan ? (
            <div className="form">
              <label>
                Monteur
                <select value={installer} onChange={(e) => setInstaller(e.target.value)}>
                  <option value="">– nicht eingeplant –</option>
                  {installers.map((p) => (
                    <option key={p.id} value={p.id}>{displayName(p)}</option>
                  ))}
                </select>
              </label>
              <div className="row">
                <label>
                  Montagedatum
                  <input type="date" value={montageDate} onChange={(e) => setMontageDate(e.target.value)} />
                </label>
                <label>
                  Uhrzeit (optional)
                  <input type="time" value={montageTime} onChange={(e) => setMontageTime(e.target.value)} />
                </label>
              </div>
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy || !planDirty}
                  onClick={() =>
                    update({
                      installer_id: installer || null,
                      montage_date: montageDate || null,
                      montage_time: montageTime || null,
                    })
                  }
                >
                  Planung speichern
                </button>
              </div>
            </div>
          ) : ticket.installer_id || ticket.montage_date ? (
            <p>
              {displayName(byId[ticket.installer_id ?? ''])}
              {ticket.montage_date && <> · {formatDay(ticket.montage_date)}</>}
              {ticket.montage_time && <> · {formatTime(ticket.montage_time)} Uhr</>}
            </p>
          ) : (
            <p className="muted">Noch nicht eingeplant.</p>
          )}
        </section>
      )}

      {einsatz && (
        <section className="card">
          <h2>Arbeitsbericht</h2>
          {isInstaller && !closed ? (
            <div className="form">
              <label>
                Was wurde gemacht?
                <textarea rows={4} value={report} onChange={(e) => setReport(e.target.value)} placeholder="z. B. Griff getauscht, Fenster neu eingestellt" />
              </label>
              <div className="actions">
                <button disabled={busy || report === ticket.work_report} onClick={() => update({ work_report: report })}>
                  Speichern
                </button>
                <button
                  className="primary"
                  disabled={busy || !report.trim()}
                  onClick={() => update({ work_report: report, status: 'abgeschlossen' })}
                >
                  Erledigt melden
                </button>
              </div>
            </div>
          ) : ticket.work_report ? (
            <p className="pre">{ticket.work_report}</p>
          ) : (
            <p className="muted">Noch kein Bericht.</p>
          )}
        </section>
      )}

      {!einsatz && (
        <>
          <section className="card">
            <h2>Verantwortlicher Teamleiter</h2>
            {isAdmin && !closed ? (
              <select
                value={ticket.assigned_to ?? ''}
                disabled={busy}
                onChange={(e) => update({ assigned_to: e.target.value || null })}
              >
                <option value="">– nicht zugewiesen –</option>
                {leads.map((p) => (
                  <option key={p.id} value={p.id}>{displayName(p)}</option>
                ))}
              </select>
            ) : (
              <p>{ticket.assigned_to ? displayName(byId[ticket.assigned_to]) : <span className="muted">Noch nicht zugewiesen</span>}</p>
            )}
          </section>

          <section className="card">
            <h2>Ursache und Maßnahme</h2>
            {ticket.review_note && ticket.status === 'in_bearbeitung' && (
              <p className="info">Hinweis aus der Prüfung: {ticket.review_note}</p>
            )}
            {canWork ? (
              <div className="form">
                <label>
                  Ursache
                  <textarea rows={4} value={cause} onChange={(e) => setCause(e.target.value)} placeholder="Warum ist der Fehler entstanden?" />
                </label>
                <label>
                  Maßnahme gegen Wiederholung
                  <textarea rows={4} value={action} onChange={(e) => setAction(e.target.value)} placeholder="Was wurde getan, damit das nicht wieder passiert?" />
                </label>
                <div className="actions">
                  <button disabled={busy || !dirty} onClick={() => update({ cause, corrective_action: action })}>
                    Speichern
                  </button>
                  {ticket.status !== 'zur_pruefung' && (
                    <button
                      className="primary"
                      disabled={busy || !cause.trim() || !action.trim()}
                      onClick={() => update({ cause, corrective_action: action, status: 'zur_pruefung' })}
                    >
                      Erledigt – zur Prüfung
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <h3>Ursache</h3>
                {ticket.cause ? <p className="pre">{ticket.cause}</p> : <p className="muted">Noch nicht eingetragen.</p>}
                <h3>Maßnahme gegen Wiederholung</h3>
                {ticket.corrective_action ? <p className="pre">{ticket.corrective_action}</p> : <p className="muted">Noch nicht eingetragen.</p>}
              </>
            )}
          </section>

          {isAdmin && ticket.status === 'zur_pruefung' && (
            <section className="card highlight">
              <h2>Prüfung</h2>
              <p className="muted small">Ursache und Maßnahme prüfen und das Ticket abschließen oder mit Hinweis zurückgeben.</p>
              <label className="form">
                Hinweis an den Teamleiter (bei Rückgabe)
                <textarea rows={2} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
              </label>
              <div className="actions">
                <button
                  disabled={busy || !reviewNote.trim()}
                  onClick={async () => {
                    if (await update({ status: 'in_bearbeitung', review_note: reviewNote.trim() })) setReviewNote('')
                  }}
                >
                  Zurück an Teamleiter
                </button>
                <button className="primary" disabled={busy} onClick={() => update({ status: 'abgeschlossen' })}>
                  Abschließen
                </button>
              </div>
            </section>
          )}

        </>
      )}

      {isAdmin && closed && (
        <div className="actions">
          <button disabled={busy} onClick={() => update({ status: einsatz ? 'zugewiesen' : 'in_bearbeitung' })}>
            Wieder öffnen
          </button>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>Verlauf</h2>
        <ul className="history">
          {events.map((ev) => (
            <li key={ev.id}>
              <span className="muted small">{formatDate(ev.created_at)}</span>
              <span>
                {EVENT_LABEL[ev.kind] ?? ev.kind}
                {ev.kind === 'status' && <> „{statusLabel(ticket.ticket_type, ev.details as TicketStatus)}"</>}
                {ev.kind === 'zugewiesen' && <> {ev.details || '–'}</>}
                {(ev.kind === 'pruefhinweis' || ev.kind === 'loeschantrag') && <> {ev.details}</>}
                {(ev.kind === 'auftrag' || ev.kind === 'eingeplant') && <> {ev.details || '–'}</>}
                {ev.kind === 'erstellt' && <> ({TYPE_LABEL[ticket.ticket_type]})</>}
                {ev.actor && <span className="muted"> · {displayName(byId[ev.actor])}</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {deletion ? (
        <section className="card danger-card">
          <h2>Löschung beantragt</h2>
          <p className="muted small">
            von {displayName(byId[deletion.requested_by])} am {formatDate(deletion.created_at)}
          </p>
          <p className="pre">{deletion.reason}</p>
          <div className="actions">
            {isAdmin && (
              <>
                <button disabled={busy} onClick={dropDeletionRequest}>Ablehnen</button>
                <button className="danger" disabled={busy} onClick={removeTicket}>Löschung freigeben</button>
              </>
            )}
            {!isAdmin && deletion.requested_by === profile.id && (
              <button disabled={busy} onClick={dropDeletionRequest}>Antrag zurückziehen</button>
            )}
            {!isAdmin && deletion.requested_by !== profile.id && (
              <p className="muted small">Wartet auf Freigabe durch QM/Admin.</p>
            )}
          </div>
        </section>
      ) : isAdmin ? (
        <div className="actions danger-zone">
          <button className="danger" onClick={removeTicket}>Ticket löschen</button>
        </div>
      ) : canRequestDeletion && requestingDeletion ? (
        <section className="card danger-card">
          <h2>Löschung beantragen</h2>
          <p className="muted small">Das Ticket wird erst gelöscht, wenn QM/Admin den Antrag freigibt.</p>
          <label className="form">
            Begründung *
            <textarea rows={3} value={deletionReason} onChange={(e) => setDeletionReason(e.target.value)} placeholder="z. B. doppelt angelegt" />
          </label>
          <div className="actions">
            <button disabled={busy} onClick={() => setRequestingDeletion(false)}>Abbrechen</button>
            <button className="danger" disabled={busy || !deletionReason.trim()} onClick={requestDeletion}>Antrag stellen</button>
          </div>
        </section>
      ) : canRequestDeletion ? (
        <div className="actions danger-zone">
          <button className="danger" onClick={() => setRequestingDeletion(true)}>Löschung beantragen</button>
        </div>
      ) : null}
    </div>
  )
}
