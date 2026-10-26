import { useState } from 'react'

// Testseite (nur Admin, ohne Menüpunkt): prüft am Android-Handy in Chrome, ob vorhandene Chips
// (z. B. SimonsVoss mit MIFARE) über Web NFC gelesen werden und welche Seriennummer sie liefern.

interface NdefReader {
  scan: (opts?: { signal?: AbortSignal }) => Promise<void>
  onreading: ((e: { serialNumber: string; message: { records: { recordType: string }[] } }) => void) | null
  onreadingerror: (() => void) | null
}

interface Read {
  at: string
  ok: boolean
  serial: string
  records: number
}

export function NfcTest() {
  const [state, setState] = useState<'aus' | 'bereit' | 'fehler'>('aus')
  const [message, setMessage] = useState('')
  const [reads, setReads] = useState<Read[]>([])
  const supported = 'NDEFReader' in window

  async function start() {
    setMessage('')
    try {
      const reader = new (window as unknown as { NDEFReader: new () => NdefReader }).NDEFReader()
      await reader.scan()
      const now = () => new Date().toLocaleTimeString('de-DE')
      reader.onreading = (e) =>
        setReads((r) => [{ at: now(), ok: true, serial: e.serialNumber || '(keine)', records: e.message.records.length }, ...r])
      reader.onreadingerror = () => setReads((r) => [{ at: now(), ok: false, serial: '', records: 0 }, ...r])
      setState('bereit')
    } catch (err) {
      setState('fehler')
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="card">
      <h1>NFC-Test</h1>
      <p className="muted small">
        Am Android-Handy in Chrome öffnen, NFC in den Einstellungen einschalten, „Lesen starten“ tippen und den Chip an die
        Rückseite des Handys halten (meist Mitte oben).
      </p>
      {!supported ? (
        <p className="error">Dieser Browser kann kein NFC lesen. Bitte am Android-Handy mit Chrome öffnen (iPhone geht nicht).</p>
      ) : (
        <div className="actions">
          <button className="primary" disabled={state === 'bereit'} onClick={start}>
            {state === 'bereit' ? 'Bereit – Chip vorhalten' : 'Lesen starten'}
          </button>
        </div>
      )}
      {message && <p className="error">{message}</p>}
      {reads.length > 0 && (
        <ul className="history">
          {reads.map((r, i) => (
            <li key={i}>
              <span className="muted small">{r.at}</span>
              {r.ok ? (
                <span>
                  <strong>Gelesen</strong> · Seriennummer <code>{r.serial}</code>
                </span>
              ) : (
                <span className="error">Chip erkannt, aber nicht lesbar</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Gleicher Chip zweimal = gleiche Seriennummer? Dann eignet er sich zum Stempeln. Ändert sich die Nummer bei jedem Vorhalten,
        nutzt der Chip eine Zufallsnummer und geht so nicht.
      </p>
    </section>
  )
}
