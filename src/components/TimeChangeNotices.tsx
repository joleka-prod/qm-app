import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { displayName, formatDate, type Profile } from '../lib/types'

interface Notice {
  id: number
  changed_by: string | null
  message: string
  created_at: string
}

// Infos, wenn jemand anderes (Personalabteilung, Vorgesetzte, Admin) die eigenen Zeiten geändert hat.
// Bleiben stehen, bis die Person sie bestätigt. Solange offene Infos da sind, sperrt die
// Zeiterfassung alles andere (außer Start/Stopp); onCount meldet die Anzahl offener Infos.
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
  const [list, setList] = useState<Notice[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('time_change_notices')
      .select('id, changed_by, message, created_at')
      .eq('user_id', userId)
      .is('confirmed_at', null)
      .order('created_at')
    const rows = (data ?? []) as Notice[]
    setList(rows)
    onCount?.(rows.length)
  }, [userId, onCount])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  async function acknowledge(id: number) {
    setBusy(true)
    setError('')
    const { error } = await supabase.rpc('confirm_time_change_notice', { p_id: id })
    if (error) setError(error.message)
    await load()
    setBusy(false)
  }

  if (!list.length) return null
  return (
    <section className="card highlight">
      <h2>Änderungen an deinen Zeiten</h2>
      <p className="small">
        Bitte lies die Änderungen und bestätige sie. Erst danach kannst du in der Zeiterfassung weiterarbeiten (Start und Stopp gehen trotzdem).
      </p>
      <ul className="vacation-list">
        {list.map((n) => (
          <li key={n.id}>
            <div>
              <div>{n.message}</div>
              <div className="small muted">
                {n.changed_by ? displayName(byId[n.changed_by]) : 'Unbekannt'} am {formatDate(n.created_at)}
              </div>
            </div>
            <div className="vacation-actions">
              <button className="primary" disabled={busy} onClick={() => acknowledge(n.id)}>Bestätigen</button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
    </section>
  )
}
