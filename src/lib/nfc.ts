// Chips lesen über Web NFC (nur Android mit Chrome). Geliefert wird die Seriennummer des Chips,
// z. B. "04:17:67:3e"; die Datenbank vereinheitlicht die Schreibweise (normalize_badge).

interface NdefReader {
  scan: (opts?: { signal?: AbortSignal }) => Promise<void>
  onreading: ((e: { serialNumber: string }) => void) | null
  onreadingerror: (() => void) | null
}

export const nfcSupported = typeof window !== 'undefined' && 'NDEFReader' in window

// Startet das Lesen; liefert eine Funktion zum Beenden. Wirft, wenn NFC aus ist oder die
// Berechtigung fehlt (beim ersten Mal muss der Start durch ein Tippen ausgelöst werden).
export async function startNfc(onRead: (serial: string) => void, onUnreadable?: () => void) {
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
