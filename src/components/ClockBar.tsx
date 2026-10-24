import { useEffect, useState } from 'react'
import { clockTime, formatMinutes, useClock, workMinutes } from '../lib/clock'

// Stempeluhr für Monteure: Arbeitszeit fürs Stundenkonto starten und stoppen
export function ClockBar({ userId }: { userId: string }) {
  const { running, loaded, clockIn, clockOut } = useClock(userId)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  async function run(fn: () => Promise<string>) {
    setBusy(true)
    setError(await fn())
    setNow(Date.now())
    setBusy(false)
  }

  if (!loaded) return null
  return (
    <div className={`clock-bar ${running ? 'clock-on' : 'clock-off'}`}>
      {running ? (
        <>
          <span>
            ● Zeiterfassung läuft seit {clockTime(running.started_at)} ({formatMinutes(workMinutes(running.started_at, null, now))})
          </span>
          <button
            disabled={busy}
            onClick={() => confirm('Zeiterfassung stoppen? Eine laufende Auftragszeit wird ebenfalls gestoppt.') && run(clockOut)}
          >
            ■ Stoppen
          </button>
        </>
      ) : (
        <>
          <span>Zeiterfassung ist aus.</span>
          <button className="primary" disabled={busy} onClick={() => run(clockIn)}>▶ Zeiterfassung starten</button>
        </>
      )}
      {error && <span className="error small">{error}</span>}
    </div>
  )
}
