import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { APPOINTMENT_LABEL, displayName, formatDate, formatDay, formatTime, type Profile, type Ticket, type TicketEvent } from '../lib/types'

interface Props {
  ticket: Ticket
  profiles: Profile[]
  byId: Record<string, Profile>
  me: string
  canEdit: boolean
  events: TicketEvent[]
  onChanged: () => Promise<void>
}

const HISTORY_LABEL: Record<string, string> = {
  eingeplant: 'Eingeplant',
  termin_angemeldet: 'Termin bei Kunde angemeldet',
  termin_bestaetigt: 'Termin von Kunde bestätigt',
  termin_zurueckgesetzt: 'Anmeldung aufgehoben',
}

// Termin mit dem Kunden: angemeldet (wer hat welchen Termin mitgeteilt) und bestätigt
export function AppointmentCard({ ticket: t, profiles, byId, me, canEdit, events, onChanged }: Props) {
  const [form, setForm] = useState<{ date: string; time: string; toldBy: string; note: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const closed = t.status === 'abgeschlossen'
  const planned = t.status === 'zugewiesen' && !!t.montage_date
  const state = t.appointment_state
  const differs =
    state !== 'offen' &&
    (t.appointment_date !== t.montage_date || (!!t.montage_time && formatTime(t.appointment_time) !== formatTime(t.montage_time)))
  const history = events.filter((e) => e.kind in HISTORY_LABEL)
  const staff = profiles.filter((p) => p.active || p.id === form?.toldBy)

  function openForm() {
    setError('')
    setForm({ date: t.montage_date ?? '', time: formatTime(t.montage_time), toldBy: me, note: '' })
  }

  async function run(call: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true)
    setError('')
    const { error } = await call()
    if (error) setError(error.message)
    else setForm(null)
    await onChanged()
    setBusy(false)
  }

  const announce = () =>
    form &&
    run(() =>
      supabase.rpc('announce_appointment', {
        p_ticket_id: t.id,
        p_date: form.date || null,
        p_time: form.time || null,
        p_told_by: form.toldBy,
        p_note: form.note,
      }),
    )
  const confirmAppointment = () => run(() => supabase.rpc('confirm_appointment', { p_ticket_id: t.id }))

  const when = (date: string | null, time: string | null) =>
    `${date ? formatDay(date) : '–'}${time ? ` um ${formatTime(time)} Uhr` : ''}`

  return (
    <section className="card">
      <h2>Termin mit dem Kunden</h2>
      {t.appointment_announced_at ? (
        <>
          <p className="appointment-line">
            <strong>{state === 'offen' ? 'Zuletzt mitgeteilt:' : 'Mitgeteilter Termin:'}</strong>{' '}
            {when(t.appointment_date, t.appointment_time)}
          </p>
          <p className="appointment-line small">
            Mitgeteilt von {t.appointment_told_by ? displayName(byId[t.appointment_told_by]) : '–'} · eingetragen am{' '}
            {formatDate(t.appointment_announced_at)}
            {t.appointment_announced_by && t.appointment_announced_by !== t.appointment_told_by && (
              <> von {displayName(byId[t.appointment_announced_by])}</>
            )}
          </p>
          {t.appointment_note && <p className="appointment-line small pre">Notiz: {t.appointment_note}</p>}
          {state === 'bestaetigt' && t.appointment_confirmed_at && (
            <p className="appointment-line small">
              <strong>Vom Kunden bestätigt</strong> · eingetragen am {formatDate(t.appointment_confirmed_at)}
              {t.appointment_confirmed_by && <> von {displayName(byId[t.appointment_confirmed_by])}</>}
            </p>
          )}
          {state === 'offen' && !closed && (
            <p className="appointment-line small appointment-warn">
              Die Planung wurde geändert. Bitte den neuen Termin beim Kunden anmelden.
            </p>
          )}
          {differs && !closed && (
            <p className="appointment-line small appointment-warn">
              Achtung: Der mitgeteilte Termin weicht von der Planung ab ({when(t.montage_date, t.montage_time)}).
            </p>
          )}
        </>
      ) : (
        <p className="muted">
          {planned ? 'Der Termin wurde dem Kunden noch nicht mitgeteilt.' : 'Sobald der Auftrag eingeplant ist, kann der Termin beim Kunden angemeldet werden.'}
        </p>
      )}

      {canEdit && planned && !form && (
        <div className="actions">
          <button className={state === 'offen' ? 'primary' : ''} disabled={busy} onClick={openForm}>
            {state === 'offen' ? APPOINTMENT_LABEL.angemeldet : 'Neu anmelden'}
          </button>
          {state === 'angemeldet' && (
            <button className="primary" disabled={busy} onClick={confirmAppointment}>
              {APPOINTMENT_LABEL.bestaetigt}
            </button>
          )}
        </div>
      )}

      {form && (
        <div className="form">
          <div className="row">
            <label>
              Mitgeteilter Termin *
              <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </label>
            <label>
              Uhrzeit
              <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            </label>
          </div>
          <label>
            Mitgeteilt von *
            <select value={form.toldBy} onChange={(e) => setForm({ ...form, toldBy: e.target.value })}>
              {staff.map((p) => (
                <option key={p.id} value={p.id}>{displayName(p)}</option>
              ))}
            </select>
          </label>
          <label>
            Notiz (optional)
            <input
              value={form.note}
              maxLength={300}
              placeholder="z. B. telefonisch mit Frau Müller"
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
          <div className="actions">
            <button disabled={busy} onClick={() => setForm(null)}>Abbrechen</button>
            <button className="primary" disabled={busy || !form.date || !form.toldBy} onClick={announce}>
              {APPOINTMENT_LABEL.angemeldet}
            </button>
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {history.length > 0 && (
        <>
          <h3 className="appointment-history-title">Verlauf</h3>
          <ul className="history appointment-history">
            {history.map((ev) => (
              <li key={ev.id} className={`appointment-ev appointment-ev-${ev.kind}`}>
                <span className="muted small">{formatDate(ev.created_at)}</span>
                <span>
                  <strong>{HISTORY_LABEL[ev.kind]}</strong>
                  {ev.details && <>: {ev.details}</>}
                  {ev.actor && <span className="muted"> · {displayName(byId[ev.actor])}</span>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
