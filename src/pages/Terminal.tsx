import { useCallback, useEffect, useRef, useState } from 'react'
import { formatBadge, nfcSupported, normalizeBadge, startNfc } from '../lib/nfc'
import {
  NetworkError,
  enqueue,
  flushQueue,
  queuedCount,
  terminalClock,
  terminalPeople,
  terminalPing,
  terminalToken,
  type ClockResult,
} from '../lib/terminal'

// Stempel-Terminal (ohne Anmeldung): Mitarbeiter halten ihren Chip an das Gerät oder stempeln mit
// Name + PIN. Ohne Netz werden Chip-Stempelungen gespeichert und später mit der Uhrzeit übertragen.

type Shown = { kind: 'kommen' | 'gehen' | 'gespeichert' | 'fehler'; title: string; sub: string }
type Mode = 'start' | 'namen' | 'pin'

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

function beep(ok: boolean) {
  try {
    const ctx = new AudioContext()
    const tones = ok ? [880] : [300, 300]
    tones.forEach((f, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = f
      g.gain.value = 0.2
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + i * 0.25)
      o.stop(ctx.currentTime + i * 0.25 + 0.15)
    })
    setTimeout(() => ctx.close(), 1000)
  } catch {
    // ohne Ton
  }
}

export function Terminal() {
  const token = terminalToken()
  const [now, setNow] = useState(new Date())
  const [name, setName] = useState('')
  const [blocked, setBlocked] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [pending, setPending] = useState(queuedCount())
  const [syncErrors, setSyncErrors] = useState<string[]>([])
  const [needsTap, setNeedsTap] = useState(false)
  const [shown, setShown] = useState<Shown | null>(null)
  const [mode, setMode] = useState<Mode>('start')
  const [people, setPeople] = useState<{ id: string; name: string }[]>([])
  const [person, setPerson] = useState<{ id: string; name: string } | null>(null)
  const [pin, setPin] = useState('')
  const busy = useRef(false)
  const lastBadge = useRef({ badge: '', at: 0 })
  const hideTimer = useRef<number | undefined>(undefined)
  const idleTimer = useRef<number | undefined>(undefined)
  const flushing = useRef(false)

  const show = useCallback((s: Shown) => {
    setShown(s)
    beep(s.kind !== 'fehler')
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setShown(null), s.kind === 'fehler' ? 6000 : 4000)
  }, [])

  const showResult = useCallback(
    (r: ClockResult) => {
      const unknown = r.message?.match(/^Unbekannter Chip \((.+)\)$/)
      if (unknown) show({ kind: 'fehler', title: 'Unbekannter Chip', sub: `Nummer ${formatBadge(unknown[1])} · bitte vom Admin zuordnen lassen` })
      else if (!r.ok) show({ kind: 'fehler', title: r.message ?? 'Fehler', sub: '' })
      // gerade eben schon gestempelt: nichts gebucht, nicht als neues Kommen/Gehen anzeigen
      else if (r.message === 'Bereits gestempelt')
        show({ kind: 'gespeichert', title: r.name ?? '', sub: `Gerade schon gestempelt (${r.action === 'kommen' ? 'Kommen' : 'Gehen'} ${fmtTime(r.at)} Uhr)` })
      else
        show({
          kind: r.action === 'kommen' ? 'kommen' : 'gehen',
          title: r.name ?? '',
          sub: `${r.action === 'kommen' ? 'Kommen' : 'Gehen'} · ${fmtTime(r.at)} Uhr${r.message ? ` · ${r.message}` : ''}`,
        })
    },
    [show],
  )

  const flush = useCallback(async () => {
    if (!token || flushing.current || queuedCount() === 0) return
    flushing.current = true
    const errors = await flushQueue(token)
    if (errors.length) setSyncErrors((e) => [...e, ...errors].slice(-10))
    setPending(queuedCount())
    flushing.current = false
  }, [token])

  const clockBadge = useCallback(
    async (raw: string) => {
      const badge = normalizeBadge(raw)
      if (!token || badge.length < 4 || busy.current) return
      // Chip liegt noch am Gerät: nicht mehrfach stempeln
      if (lastBadge.current.badge === badge && Date.now() - lastBadge.current.at < 5000) return
      lastBadge.current = { badge, at: Date.now() }
      busy.current = true
      setMode('start')
      try {
        if (!navigator.onLine) throw new NetworkError('offline')
        showResult(await terminalClock(token, { badge }))
      } catch (err) {
        if (err instanceof NetworkError) {
          enqueue(badge)
          setPending(queuedCount())
          show({ kind: 'gespeichert', title: 'Gespeichert', sub: `${fmtTime(new Date().toISOString())} Uhr · wird übertragen, sobald wieder Netz da ist` })
        } else {
          show({ kind: 'fehler', title: (err as Error).message, sub: '' })
        }
      }
      busy.current = false
    },
    [token, show, showResult],
  )

  // Uhr, Lebenszeichen, Warteschlange
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!token) return
    const ping = () =>
      terminalPing(token)
        .then((n) => {
          setName(n)
          setBlocked('')
        })
        .catch((err) => {
          if (!(err instanceof NetworkError)) setBlocked((err as Error).message)
        })
    ping()
    flush()
    const t1 = setInterval(ping, 5 * 60 * 1000)
    const t2 = setInterval(flush, 30 * 1000)
    const on = () => {
      setOnline(true)
      flush()
    }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      clearInterval(t1)
      clearInterval(t2)
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [token, flush])

  // Bildschirm anlassen
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    const request = () =>
      (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<typeof lock> } }).wakeLock
        ?.request('screen')
        .then((l) => (lock = l))
        .catch(() => undefined)
    request()
    const vis = () => document.visibilityState === 'visible' && request()
    document.addEventListener('visibilitychange', vis)
    return () => {
      document.removeEventListener('visibilitychange', vis)
      lock?.release().catch(() => undefined)
    }
  }, [])

  // Chip über NFC des Geräts
  const stopNfc = useRef<(() => void) | null>(null)
  const beginNfc = useCallback(async () => {
    if (!nfcSupported || stopNfc.current) return
    try {
      stopNfc.current = await startNfc(clockBadge, () => show({ kind: 'fehler', title: 'Chip nicht lesbar', sub: 'Bitte noch einmal ruhig vorhalten.' }))
      setNeedsTap(false)
    } catch {
      setNeedsTap(true)
    }
  }, [clockBadge, show])

  useEffect(() => {
    if (!token) return
    beginNfc()
    return () => {
      stopNfc.current?.()
      stopNfc.current = null
    }
  }, [token, beginNfc])

  // Chip über USB-Leser (meldet sich wie eine Tastatur: Nummer + Enter)
  useEffect(() => {
    let buf = ''
    let last = 0
    const key = (e: KeyboardEvent) => {
      if (mode !== 'start') return
      const t = Date.now()
      if (t - last > 300) buf = ''
      last = t
      if (e.key === 'Enter') {
        if (buf.length >= 4) clockBadge(buf)
        buf = ''
      } else if (e.key.length === 1 && /[0-9a-zA-Z]/.test(e.key)) {
        buf += e.key
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [mode, clockBadge])

  // Stempeln mit PIN: nach 30 Sekunden ohne Eingabe zurück zum Start
  useEffect(() => {
    window.clearTimeout(idleTimer.current)
    if (mode !== 'start') idleTimer.current = window.setTimeout(() => backToStart(), 30000)
    return () => window.clearTimeout(idleTimer.current)
  }, [mode, pin, person])

  function backToStart() {
    setMode('start')
    setPerson(null)
    setPin('')
  }

  async function openNames() {
    if (!token) return
    if (!navigator.onLine) {
      show({ kind: 'fehler', title: 'Ohne Netz nur mit Chip', sub: 'Stempeln mit PIN braucht eine Verbindung.' })
      return
    }
    try {
      setPeople(await terminalPeople(token))
      setMode('namen')
    } catch (err) {
      show({ kind: 'fehler', title: err instanceof NetworkError ? 'Keine Verbindung' : (err as Error).message, sub: '' })
    }
  }

  async function submitPin() {
    if (!token || !person || pin.length < 4 || busy.current) return
    busy.current = true
    try {
      const r = await terminalClock(token, { user: person.id, pin })
      showResult(r)
      if (r.ok || !r.message?.startsWith('PIN falsch')) backToStart()
      else setPin('')
    } catch (err) {
      show({ kind: 'fehler', title: err instanceof NetworkError ? 'Keine Verbindung' : (err as Error).message, sub: '' })
      backToStart()
    }
    busy.current = false
  }

  if (!token) {
    return (
      <div className="terminal">
        <div className="terminal-center">
          <h1>Kein Stempel-Terminal</h1>
          <p>Dieses Gerät ist noch nicht als Terminal eingerichtet.</p>
          <p className="terminal-hint">
            Als Admin anmelden und unter <a href="/personal?ansicht=benutzer">Personal → Stempel-Terminals</a> „Dieses Gerät als Terminal
            einrichten“ wählen.
          </p>
        </div>
      </div>
    )
  }

  if (blocked) {
    return (
      <div className="terminal">
        <div className="terminal-center">
          <h1>Terminal gesperrt</h1>
          <p>{blocked}. Bitte den Admin fragen.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="terminal" onClick={needsTap ? beginNfc : undefined}>
      <header className="terminal-head">
        <span>{name || 'Stempel-Terminal'}</span>
        <span className={online ? '' : 'terminal-offline'}>{online ? '' : 'Offline'}</span>
      </header>

      {shown ? (
        <div className={`terminal-center terminal-shown terminal-${shown.kind}`} onClick={() => setShown(null)}>
          <div className="terminal-icon">{shown.kind === 'kommen' ? '→' : shown.kind === 'gehen' ? '←' : shown.kind === 'gespeichert' ? '✓' : '!'}</div>
          <h1>{shown.title}</h1>
          {shown.sub && <p>{shown.sub}</p>}
        </div>
      ) : mode === 'namen' ? (
        <div className="terminal-pick">
          <h2>Wer bist du?</h2>
          <div className="terminal-names">
            {people.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setPerson(p)
                  setPin('')
                  setMode('pin')
                }}
              >
                {p.name}
              </button>
            ))}
            {people.length === 0 && <p>Noch niemand hat eine PIN.</p>}
          </div>
          <button className="terminal-back" onClick={backToStart}>Abbrechen</button>
        </div>
      ) : mode === 'pin' && person ? (
        <div className="terminal-pick">
          <h2>{person.name}: PIN eingeben</h2>
          <div className="terminal-pin">{'●'.repeat(pin.length) || ' '}</div>
          <div className="terminal-keys">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].map((k) => (
              <button
                key={k}
                className={k === 'OK' ? 'primary' : ''}
                disabled={k === 'OK' && pin.length < 4}
                onClick={() => (k === 'OK' ? submitPin() : k === '⌫' ? setPin(pin.slice(0, -1)) : pin.length < 8 && setPin(pin + k))}
              >
                {k}
              </button>
            ))}
          </div>
          <button className="terminal-back" onClick={backToStart}>Abbrechen</button>
        </div>
      ) : (
        <div className="terminal-center">
          <div className="terminal-clock">{now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</div>
          <div className="terminal-date">{now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <p className="terminal-prompt">{needsTap ? 'Einmal auf den Bildschirm tippen, um das Lesen zu starten' : 'Chip vorhalten'}</p>
          <button className="terminal-pin-button" onClick={(e) => (e.stopPropagation(), openNames())}>
            Ohne Chip stempeln (PIN)
          </button>
        </div>
      )}

      <footer className="terminal-foot">
        {pending > 0 && <span>{pending} Stempelung{pending === 1 ? '' : 'en'} warten auf Übertragung</span>}
        {syncErrors.map((e, i) => (
          <span key={i} className="terminal-sync-error">Nicht übernommen: {e}</span>
        ))}
        {syncErrors.length > 0 && (
          <button className="link" onClick={() => setSyncErrors([])}>Ausblenden</button>
        )}
      </footer>
    </div>
  )
}
