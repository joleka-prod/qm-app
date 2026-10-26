import { useEffect } from 'react'
import { useAuth } from '../auth'
import { prefetchForInstaller } from '../lib/loaders'
import { dismissFailed, flush, useOfflineState } from '../lib/offline'

function time(iso: string) {
  const d = new Date(iso)
  const today = d.toDateString() === new Date().toDateString()
  return today
    ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// Hinweis oben in der App: offline, wartende Änderungen, Fehler bei der Übertragung.
// Für Monteure werden außerdem die Einsätze der nächsten Tage im Handy gespeichert.
export function OfflineBar() {
  const { profile } = useAuth()
  const s = useOfflineState()
  const installer = profile?.role === 'monteur'

  useEffect(() => {
    if (!installer || !profile) return
    const run = () => void prefetchForInstaller(profile.id)
    const onVisible = () => document.visibilityState === 'visible' && run()
    run()
    window.addEventListener('online', run)
    document.addEventListener('visibilitychange', onVisible)
    const t = setInterval(run, 15 * 60 * 1000)
    return () => {
      window.removeEventListener('online', run)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(t)
    }
  }, [installer, profile])

  if (s.online && s.pending === 0 && s.failed.length === 0) return null
  return (
    <div className="offline-bar">
      {!s.online && (
        <div className="offline-line offline-off">
          <strong>Offline</strong>
          {s.savedAt ? ` · angezeigt wird der Stand von ${time(s.savedAt)}` : ' · angezeigt wird der zuletzt geladene Stand'}
        </div>
      )}
      {s.pending > 0 && (
        <div className="offline-line offline-wait">
          <span>
            {s.syncing
              ? 'Änderungen werden übertragen …'
              : `${s.pending} ${s.pending === 1 ? 'Änderung wartet' : 'Änderungen warten'} auf Übertragung${s.online ? '' : ', sobald wieder Empfang da ist'}.`}
          </span>
          {s.online && !s.syncing && (
            <button className="link" onClick={() => void flush()}>Jetzt übertragen</button>
          )}
        </div>
      )}
      {s.failed.length > 0 && (
        <div className="offline-line offline-failed">
          <div>
            <strong>Nicht übertragen:</strong>
            <ul>
              {s.failed.map((f, i) => (
                <li key={i}>
                  {f.label} ({time(f.at)}): {f.message}
                </li>
              ))}
            </ul>
            <span className="small">Bitte prüfen und bei Bedarf erneut erfassen.</span>
          </div>
          <button className="link" onClick={() => void dismissFailed()}>Verstanden</button>
        </div>
      )}
    </div>
  )
}
