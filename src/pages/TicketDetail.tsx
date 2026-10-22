import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { PhotoGallery } from '../components/PhotoGallery'
import { PhotoPicker } from '../components/PhotoPicker'
import { StatusBadge } from '../components/StatusBadge'
import { deletePhoto, uploadPhotos } from '../lib/photos'
import { supabase } from '../lib/supabase'
import {
  STATUS_LABEL,
  displayName,
  formatDate,
  ticketNo,
  type Ticket,
  type TicketEvent,
  type TicketPhoto,
  type TicketStatus,
} from '../lib/types'
import { useProfiles } from '../lib/useProfiles'

const EVENT_LABEL: Record<string, string> = {
  erstellt: 'Ticket erstellt',
  zugewiesen: 'Zugewiesen an',
  ursache: 'Ursache bearbeitet',
  massnahme: 'Maßnahme bearbeitet',
  status: 'Status geändert auf',
  pruefhinweis: 'Prüfhinweis',
}

export function TicketDetail() {
  const { id } = useParams()
  const ticketId = Number(id)
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { byId, leads } = useProfiles()

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
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  const load = useCallback(async () => {
    const [t, p, e] = await Promise.all([
      supabase.from('tickets').select('*').eq('id', ticketId).maybeSingle(),
      supabase.from('ticket_photos').select('*').eq('ticket_id', ticketId).order('created_at'),
      supabase.from('ticket_events').select('*').eq('ticket_id', ticketId).order('created_at'),
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
    setPhotos((p.data ?? []) as TicketPhoto[])
    setEvents((e.data ?? []) as TicketEvent[])
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
  const canEditBase = isAdmin || (ticket.created_by === profile.id && ticket.status === 'neu')
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

  async function removeTicket() {
    if (!confirm('Ticket mit allen Fotos endgültig löschen?')) return
    if (photos.length > 0) {
      await supabase.storage.from('ticket-photos').remove(photos.map((p) => p.storage_path))
    }
    const { error } = await supabase.from('tickets').delete().eq('id', ticketId)
    if (error) setError(error.message)
    else navigate('/', { replace: true })
  }

  return (
    <div className="detail">
      <Link to="/" className="back">← Alle Tickets</Link>

      <section className="card">
        <div className="ticket-row-top">
          <span className="ticket-no">{ticketNo(ticket.id)}</span>
          <StatusBadge status={ticket.status} />
        </div>
        {editing ? (
          <div className="form">
            <label>
              Kurzbeschreibung
              <input value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              Beschreibung
              <textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <div className="actions">
              <button onClick={() => { setEditing(false); setTitle(ticket.title); setDescription(ticket.description) }}>Abbrechen</button>
              <button
                className="primary"
                disabled={busy || !title.trim()}
                onClick={async () => {
                  if (await update({ title: title.trim(), description: description.trim() })) setEditing(false)
                }}
              >
                Speichern
              </button>
            </div>
          </div>
        ) : (
          <>
            <h1 className="ticket-heading">{ticket.title}</h1>
            <p className="muted small">
              Erstellt {formatDate(ticket.created_at)} von {displayName(byId[ticket.created_by])}
              {ticket.closed_at && <> · Abgeschlossen {formatDate(ticket.closed_at)}</>}
            </p>
            {ticket.description ? <p className="pre">{ticket.description}</p> : <p className="muted">Keine Beschreibung.</p>}
            {canEditBase && <button className="link" onClick={() => setEditing(true)}>Bearbeiten</button>}
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

      {isAdmin && closed && (
        <div className="actions">
          <button disabled={busy} onClick={() => update({ status: 'in_bearbeitung' })}>Wieder öffnen</button>
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
                {ev.kind === 'status' && <> „{STATUS_LABEL[ev.details as TicketStatus] ?? ev.details}"</>}
                {ev.kind === 'zugewiesen' && <> {ev.details || '–'}</>}
                {ev.kind === 'pruefhinweis' && <>: {ev.details}</>}
                {ev.actor && <span className="muted"> · {displayName(byId[ev.actor])}</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && (
        <div className="actions danger-zone">
          <button className="danger" onClick={removeTicket}>Ticket löschen</button>
        </div>
      )}
    </div>
  )
}
