import { createClient } from '@supabase/supabase-js'
import type { Session } from '@supabase/supabase-js'
import { configureOffline, isOffline, offlineFetch } from './offline'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configMissing = !url || !anonKey

// Einladungs- und Passwort-Links landen mit #type=invite bzw. #type=recovery in der URL.
// Das muss gelesen werden, bevor der Supabase-Client den Hash entfernt.
const hashParams = new URLSearchParams(window.location.hash.slice(1))
export const arrivedViaLinkType = hashParams.get('type')

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  // Offline-Modus: Lesen aus dem Handy-Speicher, Änderungen in der Warteschlange (lib/offline.ts)
  global: { fetch: offlineFetch },
})

// Im Handy gespeicherte Anmeldung (auch wenn der Zugang abgelaufen ist)
export function storedSession(): Session | null {
  try {
    const key = (supabase.auth as unknown as { storageKey: string }).storageKey
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

// Ohne Empfang versucht supabase-js einen abgelaufenen Zugang bis zu 30 Sekunden lang zu erneuern,
// und jede Anfrage wartet darauf. Offline gilt deshalb sofort die gespeicherte Anmeldung; erneuert
// wird sie, sobald wieder Netz da ist (Übertragung der Warteschlange holt sich dann einen frischen Zugang).
const onlineGetSession = supabase.auth.getSession.bind(supabase.auth)
supabase.auth.getSession = async () => {
  const s = isOffline() ? storedSession() : null
  return s ? { data: { session: s }, error: null } : onlineGetSession()
}

// Ohne Netz keine Erneuerungsversuche im Hintergrund (sie blockieren sonst nach dem Wiederverbinden)
window.addEventListener('offline', () => void supabase.auth.stopAutoRefresh())
window.addEventListener('online', () => void supabase.auth.startAutoRefresh())
if (!navigator.onLine) void supabase.auth.stopAutoRefresh()

// Übertragen der Warteschlange immer mit frischem Zugang
configureOffline(async () => (await onlineGetSession()).data.session?.access_token ?? null)
