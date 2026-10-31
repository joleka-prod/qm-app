import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { displayName, formatDate, type Profile } from '../lib/types'

interface Notice {
  id: number
  user_id: string
  changed_by: string | null
  message: string
  created_at: string
  rejected_at: string | null
  reject_reason: string | null
}

const COLS = 'id, user_id, changed_by, message, created_at, rejected_at, reject_reason'

// Infos, wenn jemand anderes (Personalabteilung, Vorgesetzte, Admin) die eigenen Zeiten geändert hat.
// Die Person bestätigt sie oder lehnt sie mit Grund ab. Eine Ablehnung erscheint dann bei der
// Person, die geändert hat, und wird dort nur zur Kenntnis genommen.
// Solange offene Infos da sind, sperrt die Zeiterfassung alles andere (außer Start/Stopp);
// onCount meldet die Anzahl offener Infos.
export function TimeChangeNotices({
  userId,
  byId,
  reloadKey,
  onCount,
}: {
  userId: string
  byId: Record<string, Profile>
  reloadKey?: unknown
  onCount?: (n: number) => void
}) {
  const [own, setOwn] = useState<Notice[]>([])
  const [rejected, setRejected] = useState<Notice[]>([])
  const [rejecting, setRejecting] = useState<{ id: number; reason: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase.from('time_change_notices').select(COLS).eq('user_id', userId).is('confirmed_at', null).order('created_at'),
      supabase
        .from('time_change_notices')
        .select(COLS)
        .eq('changed_by', userId)
        .not('rejected_at', 'is', null)
        .is('reply_confirmed_at', null)
        .order('rejected_at'),
    ])
    const o = (a.data ?? []) as Notice[]
    const r = (b.data ?? []) as Notice[]
    setOwn(o)
    setRejected(r)
    onCount?.(o.length + r.length)
  }, [userId, onCount])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  async function run(fn: string, args: Record<string, unknown>) {
    setBusy(true)
    setError('')
    const { error } = await supabase.rpc(fn, args)
    if (error) setError(error.message)
    else setRejecting(null)
    await load()
    setBusy(false)
  }

  if (!own.length && !rejected.length) return null
  return (
    <>
      {own.length > 0 && (
        <section className="card highlight">
          <h2>Änderungen an deinen Zeiten</h2>
          <p className="small">
            Bitte lies die Änderungen und bestätige sie oder lehne sie mit Grund ab. Erst danach kannst du in der Zeiterfassung weiterarbeiten (Start und
            Stopp gehen trotzdem).
          </p>
          <ul className="vacation-list">
            {own.map((n) => (
              <li key={n.id}>
                <div>
                  <div>{n.message}</div>
                  <div className="small muted">
                    {n.changed_by ? displayName(byId[n.changed_by]) : 'Unbekannt'} am {formatDate(n.created_at)}
                  </div>
                  {rejecting?.id === n.id && (
                    <div className="form">
                      <label>
                        Grund der Ablehnung *
                        <input
                          autoFocus
                          value={rejecting.reason}
                          maxLength={300}
                          onChange={(e) => setRejecting({ id: n.id, reason: e.target.value })}
                          placeholder="z. B. Ich war an dem Tag bis 16:30 Uhr da"
                        />
                      </label>
                      <div className="actions">
                        <button disabled={busy} onClick={() => setRejecting(null)}>Abbrechen</button>
                        <button
                          className="primary"
                          disabled={busy || rejecting.reason.trim().length < 3}
                          onClick={() => run('reject_time_change_notice', { p_id: n.id, p_reason: rejecting.reason.trim() })}
                        >
                          Ablehnung senden
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {rejecting?.id !== n.id && (
                  <div className="vacation-actions">
                    <button
                      disabled={busy}
                      onClick={() => {
                        setError('')
                        setRejecting({ id: n.id, reason: '' })
                      }}
                    >
                      Ablehnen
                    </button>
                    <button className="primary" disabled={busy} onClick={() => run('confirm_time_change_notice', { p_id: n.id })}>
                      Bestätigen
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {rejected.length > 0 && (
        <section className="card highlight">
          <h2>Abgelehnte Änderungen</h2>
          <p className="small">
            Diese Änderungen, die du vorgenommen hast, wurden abgelehnt. Sie gelten trotzdem weiter; korrigiere sie bei Bedarf. Bitte zur Kenntnis nehmen.
          </p>
          <ul className="vacation-list">
            {rejected.map((n) => (
              <li key={n.id}>
                <div>
                  <div>
                    <strong>{displayName(byId[n.user_id])}:</strong> {n.message}
                  </div>
                  <div>Grund: {n.reject_reason}</div>
                  <div className="small muted">abgelehnt am {formatDate(n.rejected_at!)}</div>
                </div>
                <div className="vacation-actions">
                  <button className="primary" disabled={busy} onClick={() => run('confirm_time_change_rejection', { p_id: n.id })}>
                    Zur Kenntnis genommen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && <p className="error">{error}</p>}
    </>
  )
}
