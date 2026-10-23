import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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

export function formatMinutes(m: number) {
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

// ISO -> Wert für <input type="datetime-local"> in Ortszeit
function toLocalInput(iso: string | null) {
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

// Zeiterfassung im Einsatz: Start/Stopp für Monteure, Übersicht und Korrektur für Planer
export function TimeCard({ ticket, me, isInstaller, isPlanner, isAdmin, byId }: Props) {
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [running, setRunning] = useState<TimeEntry | null>(null)
  const [now, setNow] = useState(Date.now())
  const [edit, setEdit] = useState<{ id: number; start: string; end: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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

  if (!isInstaller && !isPlanner && entries.length === 0) return null

  return (
    <section className="card">
      <h2>Zeiterfassung</h2>

      {isInstaller && !closed && (
        <div className="time-controls">
          {running && runningHere && (
            <p className="time-running">
              ● {KIND_LABEL[running.kind]} läuft seit {clock(running.started_at)} ({formatMinutes(minutesOf(running, now))})
            </p>
          )}
          {running && !runningHere && (
            <p className="small muted">
              Bei dir läuft noch {KIND_LABEL[running.kind]} in einem <Link to={`/ticket/${running.ticket_id}`}>anderen Einsatz</Link>.
              Ein Start hier beendet sie.
            </p>
          )}
          <div className="time-buttons">
            <button disabled={busy || (runningHere && running?.kind === 'fahrt')} onClick={() => start('fahrt')}>
              🚐 Fahrt starten
            </button>
            <button disabled={busy || (runningHere && running?.kind === 'arbeit')} onClick={() => start('arbeit')}>
              🔧 Arbeit starten
            </button>
            {runningHere && (
              <button className="primary" disabled={busy} onClick={stop}>■ Stopp</button>
            )}
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="muted small">Noch keine Zeiten erfasst.</p>
      ) : (
        <>
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
                    {formatDate(e.started_at)} – {e.ended_at ? clock(e.ended_at) : 'läuft'}
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
            <span>Fahrt {formatMinutes(totals.fahrt)}</span>
            <span>Arbeit {formatMinutes(totals.arbeit)}</span>
            <strong>Gesamt {formatMinutes(totals.fahrt + totals.arbeit)}</strong>
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}
