import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatMinutes, notifyClockChanged, useClock, useClockChanged } from '../lib/clock'
import { supabase } from '../lib/supabase'
import { displayName, formatDate, type Profile, type Ticket } from '../lib/types'

export type TimeKind = 'fahrt' | 'arbeit'

export interface TimeEntry {
  id: number
  ticket_id: number
  installer_id: string
  kind: TimeKind
  started_at: string
  ended_at: string | null
  note: string
  edited_by: string | null
}

export const KIND_LABEL: Record<TimeKind, string> = { fahrt: 'Fahrt', arbeit: 'Arbeit' }

export function minutesOf(e: Pick<TimeEntry, 'started_at' | 'ended_at'>, now = Date.now()) {
  const end = e.ended_at ? new Date(e.ended_at).getTime() : now
  return Math.max(0, Math.round((end - new Date(e.started_at).getTime()) / 60000))
}

// Erster Beginn und letztes Ende aller Zeiten eines Auftrags
export function workSpan(list: Pick<TimeEntry, 'started_at' | 'ended_at'>[]) {
  let start: string | null = null
  let end: string | null = null
  let running = false
  for (const e of list) {
    if (!start || e.started_at < start) start = e.started_at
    if (!e.ended_at) running = true
    else if (!end || e.ended_at > end) end = e.ended_at
  }
  return { start, end, running }
}

function clockAt(iso: string) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

// ISO -> Wert für <input type="datetime-local"> in Ortszeit
export function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

interface Props {
  ticket: Ticket
  me: string
  isInstaller: boolean
  isPlanner: boolean
  isAdmin: boolean
  byId: Record<string, Profile>
}

// Auftragszeit: Monteure starten und stoppen die Arbeit am Auftrag (nur eingestempelt),
// Planer sehen und korrigieren alle Zeiten
export function TimeCard({ ticket, me, isInstaller, isPlanner, isAdmin, byId }: Props) {
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [running, setRunning] = useState<TimeEntry | null>(null)
  const [now, setNow] = useState(Date.now())
  const [edit, setEdit] = useState<{ id: number; start: string; end: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const clock = useClock(isInstaller ? me : undefined)

  const load = useCallback(async () => {
    const [list, mine] = await Promise.all([
      supabase.from('time_entries').select('*').eq('ticket_id', ticket.id).order('started_at'),
      supabase.from('time_entries').select('*').eq('installer_id', me).is('ended_at', null).maybeSingle(),
    ])
    setEntries((list.data ?? []) as TimeEntry[])
    setRunning((mine.data ?? null) as TimeEntry | null)
  }, [ticket.id, me])

  useEffect(() => {
    load()
  }, [load, ticket.status])
  useClockChanged(load)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  async function call(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true)
    setError('')
    const { error } = await fn()
    if (error) setError(error.message)
    await load()
    notifyClockChanged()
    setNow(Date.now())
    setBusy(false)
  }

  const start = (kind: TimeKind) => call(() => supabase.rpc('start_time_entry', { p_ticket_id: ticket.id, p_kind: kind }))
  const stop = () => call(() => supabase.rpc('stop_time_entry'))

  async function saveEdit() {
    if (!edit) return
    setBusy(true)
    setError('')
    const { error } = await supabase
      .from('time_entries')
      .update({ started_at: new Date(edit.start).toISOString(), ended_at: edit.end ? new Date(edit.end).toISOString() : null })
      .eq('id', edit.id)
    if (error) setError(error.message)
    else setEdit(null)
    await load()
    setBusy(false)
  }

  const remove = (id: number) => confirm('Diese Zeit löschen?') && call(() => supabase.from('time_entries').delete().eq('id', id))

  const closed = ticket.status === 'abgeschlossen'
  const runningHere = running?.ticket_id === ticket.id
  const totals = { fahrt: 0, arbeit: 0 } as Record<TimeKind, number>
  for (const e of entries) totals[e.kind] += minutesOf(e, now)
  const span = workSpan(entries)

  if (!isInstaller && !isPlanner && entries.length === 0) return null

  return (
    <section className="card">
      <h2>Zeit für diesen Auftrag</h2>

      {isInstaller && !closed && (
        <div className="time-controls">
          {!clock.running && clock.loaded && (
            <p className="small appointment-warn">
              Bitte zuerst im Menüpunkt <Link to="/zeiterfassung">Zeiterfassung</Link> die Zeiterfassung starten.
            </p>
          )}
          {running && runningHere && (
            <p className="time-running">
              ● Arbeit am Auftrag läuft seit {clockAt(running.started_at)} ({formatMinutes(minutesOf(running, now))})
            </p>
          )}
          {running && !runningHere && (
            <p className="small muted">
              Bei dir läuft noch die Zeit für einen <Link to={`/ticket/${running.ticket_id}`}>anderen Auftrag</Link>. Ein Start hier
              beendet sie.
            </p>
          )}
          <div className="time-buttons">
            {runningHere ? (
              <button className="primary" disabled={busy} onClick={stop}>■ Arbeit am Auftrag stoppen</button>
            ) : (
              <button className="primary" disabled={busy || !clock.running} onClick={() => start('arbeit')}>
                ▶ Arbeit am Auftrag starten
              </button>
            )}
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="muted small">Noch keine Zeiten erfasst.</p>
      ) : (
        <>
          <dl className="time-summary">
            <div><dt>Arbeitsbeginn</dt><dd>{span.start ? formatDate(span.start) : '–'}</dd></div>
            <div><dt>Arbeitsende</dt><dd>{span.running ? 'läuft noch' : span.end ? formatDate(span.end) : '–'}</dd></div>
            <div><dt>Gesamtarbeitszeit</dt><dd>{formatMinutes(totals.fahrt + totals.arbeit)}</dd></div>
          </dl>
          <ul className="time-list">
            {entries.map((e) =>
              edit?.id === e.id ? (
                <li key={e.id} className="form time-edit">
                  <div className="row">
                    <label>
                      Beginn
                      <input type="datetime-local" value={edit.start} onChange={(ev) => setEdit({ ...edit, start: ev.target.value })} />
                    </label>
                    <label>
                      Ende
                      <input type="datetime-local" value={edit.end} onChange={(ev) => setEdit({ ...edit, end: ev.target.value })} />
                    </label>
                  </div>
                  <div className="actions">
                    <button disabled={busy} onClick={() => setEdit(null)}>Abbrechen</button>
                    <button className="primary" disabled={busy || !edit.start} onClick={saveEdit}>Speichern</button>
                  </div>
                </li>
              ) : (
                <li key={e.id}>
                  <span className={`time-kind time-kind-${e.kind}`}>{KIND_LABEL[e.kind]}</span>
                  <span className="time-who">{displayName(byId[e.installer_id])}</span>
                  <span className="time-span small">
                    {formatDate(e.started_at)} – {e.ended_at ? clockAt(e.ended_at) : 'läuft'}
                    {e.edited_by && <span className="muted"> · korrigiert von {displayName(byId[e.edited_by])}</span>}
                  </span>
                  <span className="time-dur">{formatMinutes(minutesOf(e, now))}</span>
                  {isPlanner && (
                    <span className="time-actions">
                      <button className="link" onClick={() => setEdit({ id: e.id, start: toLocalInput(e.started_at), end: toLocalInput(e.ended_at) })}>
                        Korrigieren
                      </button>
                      {isAdmin && (
                        <button className="link danger" onClick={() => remove(e.id)}>Löschen</button>
                      )}
                    </span>
                  )}
                </li>
              ),
            )}
          </ul>
          <div className="time-totals">
            {totals.fahrt > 0 && <span>Fahrt {formatMinutes(totals.fahrt)}</span>}
            {totals.fahrt > 0 && <span>Arbeit {formatMinutes(totals.arbeit)}</span>}
            <strong>Gesamt {formatMinutes(totals.fahrt + totals.arbeit)}</strong>
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}
