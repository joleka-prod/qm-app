// Chips lesen über Web NFC (Android mit Chrome) oder in der Kiosk-App Fully Kiosk Browser über deren
// JavaScript-Schnittstelle (Fabian, 2026-10-30). Geliefert wird die Seriennummer des Chips,
// z. B. "04:17:67:3e"; die Datenbank vereinheitlicht die Schreibweise (normalize_badge).

interface NdefReader {
  scan: (opts?: { signal?: AbortSignal }) => Promise<void>
  onreading: ((e: { serialNumber: string }) => void) | null
  onreadingerror: (() => void) | null
}

// Fully Kiosk Browser (PLUS, Einstellung „Enable JavaScript Interface“) stellt window.fully bereit
interface Fully {
  bind: (event: string, code: string) => void
  nfcScanStart: () => boolean
  nfcScanStop: () => boolean
}
const fully = () => (typeof window !== 'undefined' ? (window as unknown as { fully?: Fully }).fully : undefined)
type FullyWindow = { __fullyNfc?: (serial: string) => void }

export const nfcSupported = typeof window !== 'undefined' && ('NDEFReader' in window || !!fully()?.nfcScanStart)

// Startet das Lesen; liefert eine Funktion zum Beenden. Wirft, wenn NFC aus ist oder die
// Berechtigung fehlt (beim ersten Mal muss der Start durch ein Tippen ausgelöst werden).
export async function startNfc(onRead: (serial: string) => void, onUnreadable?: () => void) {
  const f = fully()
  if (f?.nfcScanStart) {
    // Fully ruft den gebundenen Code als Text auf; $serial ersetzt die App durch die Seriennummer
    const w = window as unknown as FullyWindow
    w.__fullyNfc = (serial) => (serial ? onRead(serial) : onUnreadable?.())
    f.bind('onNfcTagDiscovered', 'window.__fullyNfc && window.__fullyNfc("$serial");')
    if (!f.nfcScanStart()) throw new Error('NFC in Fully Kiosk nicht verfügbar')
    return () => {
      f.nfcScanStop()
      w.__fullyNfc = undefined
    }
  }
  const ctrl = new AbortController()
  const reader = new (window as unknown as { NDEFReader: new () => NdefReader }).NDEFReader()
  reader.onreading = (e) => (e.serialNumber ? onRead(e.serialNumber) : onUnreadable?.())
  reader.onreadingerror = () => onUnreadable?.()
  await reader.scan({ signal: ctrl.signal })
  return () => ctrl.abort()
}

// Seriennummer wie in der Datenbank: nur Ziffern/Buchstaben, klein
export function normalizeBadge(s: string) {
  return s.replace(/[^0-9a-zA-Z]/g, '').toLowerCase()
}

// Zur Anzeige: 0417673e -> 04:17:67:3E (nur bei Hex-Nummern mit gerader Länge)
export function formatBadge(s: string | null | undefined) {
  if (!s) return ''
  return /^[0-9a-f]+$/.test(s) && s.length % 2 === 0 ? s.toUpperCase().match(/../g)!.join(':') : s
}
