import { useCallback, useEffect, useRef, useState } from 'react'
import { formatBadge, nfcMode, normalizeBadge, startNfc } from '../lib/nfc'
import {
  NetworkError,
  enqueue,
  flushQueue,
  queuedCount,
  terminalClock,
  terminalPing,
  terminalToken,
  type ClockResult,
} from '../lib/terminal'

// Stempel-Terminal (ohne Anmeldung): Mitarbeiter halten ihren Chip an das Gerät. Stempeln ohne Chip
// (Name + PIN) gibt es nicht mehr (Fabian, 2026-10-30). Ohne Netz werden Chip-Stempelungen gespeichert und später mit der Uhrzeit übertragen.

type Shown = { kind: 'kommen' | 'gehen' | 'gespeichert' | 'fehler'; title: string; sub: string }

const LOGOS = [
  { name: 'JOLEKA', src: '/logo.jpg' },
  { name: 'Ursprung', src: '/logo-ursprung.png' },
  { name: 'Kalverkamp', src: '/logo-kalverkamp.png' },
]

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
  const [nfcError, setNfcError] = useState('')
  const [shown, setShown] = useState<Shown | null>(null)
  const busy = useRef(false)
  const lastBadge = useRef({ badge: '', at: 0 })
  const hideTimer = useRef<number | undefined>(undefined)
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

  // Vollbild (ohne Adress- und Navigationsleiste): Browser erlauben das nur nach einer Berührung,
  // daher bei jedem Antippen erneut anfordern, solange es nicht aktiv ist (Fabian, 2026-10-30)
  const [fullscreen, setFullscreen] = useState(() => !!document.fullscreenElement)
  useEffect(() => {
    const change = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', change)
    return () => document.removeEventListener('fullscreenchange', change)
  }, [])
  const enterFullscreen = useCallback(() => {
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) return
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined)
  }, [])

  // Chip über NFC des Geräts
  const stopNfc = useRef<(() => void) | null>(null)
  const nfcStarting = useRef(false)
  const beginNfc = useCallback(async () => {
    if (!nfcMode() || stopNfc.current || nfcStarting.current) return
    nfcStarting.current = true
    try {
      stopNfc.current = await startNfc(clockBadge, () => show({ kind: 'fehler', title: 'Chip nicht lesbar', sub: 'Bitte noch einmal ruhig vorhalten.' }))
      setNeedsTap(false)
      setNfcError('')
    } catch (err) {
      setNfcError((err as Error).message || 'Start fehlgeschlagen')
      setNeedsTap(true)
    }
    nfcStarting.current = false
  }, [clockBadge, show])

  useEffect(() => {
    if (!token) return
    beginNfc()
    // Fully Kiosk stellt seine Schnittstelle manchmal erst nach dem Laden bereit: Leser so lange
    // automatisch neu starten, bis er läuft (sonst müsste erst jemand auf den Bildschirm tippen)
    const retry = setInterval(() => {
      if (!stopNfc.current) beginNfc()
    }, 2000)
    return () => {
      clearInterval(retry)
      stopNfc.current?.()
      stopNfc.current = null
    }
  }, [token, beginNfc])

  // Chip über USB-Leser (meldet sich wie eine Tastatur: Nummer + Enter)
  useEffect(() => {
    let buf = ''
    let last = 0
    const key = (e: KeyboardEvent) => {
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
  }, [clockBadge])

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
    <div className="terminal" onPointerDown={enterFullscreen} onClick={needsTap ? beginNfc : undefined}>
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
      ) : (
        <div className="terminal-center">
          <div className="terminal-clock">{now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</div>
          <div className="terminal-date">{now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <p className="terminal-prompt">{needsTap ? 'Einmal auf den Bildschirm tippen, um das Lesen zu starten' : 'Chip vorhalten'}</p>
          <p className="terminal-tag">#wirsindjoleka</p>
        </div>
      )}

      {/* Unsere drei Unternehmen (Fabian, 2026-10-30) */}
      <div className="terminal-logos">
        {LOGOS.map((l) => (
          <img key={l.src} src={l.src} alt={l.name} />
        ))}
      </div>

      <footer className="terminal-foot">
        {!fullscreen && <span>Für Vollbild einmal auf den Bildschirm tippen</span>}
        <span className="terminal-version">
          Version {__BUILD__} · NFC: {nfcMode() || 'nicht verfügbar'}{nfcError ? ` (${nfcError})` : ''}
        </span>
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
