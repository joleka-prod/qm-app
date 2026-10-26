import { supabaseAnonKey, supabaseUrl } from './supabase'

// Stempel-Terminal: Schlüssel des Geräts, Aufrufe an die Datenbank und Warteschlange für Stempelungen
// ohne Netz. Das Terminal ist nicht angemeldet; es weist sich mit dem Schlüssel aus (terminal_auth).

const TOKEN_KEY = 'terminal-token'
const QUEUE_KEY = 'terminal-queue'

export function terminalToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setTerminalToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ohne Speicher kein Terminal
  }
}

export class NetworkError extends Error {}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  let res: Response
  try {
    res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: ctrl.signal,
    })
  } catch {
    throw new NetworkError('Keine Verbindung')
  } finally {
    clearTimeout(timer)
  }
  if (res.status >= 500 || res.status === 408 || res.status === 429) throw new NetworkError(`Server nicht erreichbar (${res.status})`)
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error((body as { message?: string } | null)?.message ?? `Fehler ${res.status}`)
  return body as T
}

export interface ClockResult {
  ok: boolean
  message: string | null
  name: string | null
  action: 'kommen' | 'gehen' | null
  at: string
}

export const terminalPing = (token: string) => rpc<string>('terminal_ping', { p_token: token })
export const terminalPeople = (token: string) => rpc<{ id: string; name: string }[]>('terminal_people', { p_token: token })

export async function terminalClock(token: string, args: { badge?: string; user?: string; pin?: string; at?: string }) {
  const rows = await rpc<ClockResult[]>('terminal_clock', {
    p_token: token,
    p_badge: args.badge ?? null,
    p_user: args.user ?? null,
    p_pin: args.pin ?? null,
    p_at: args.at ?? null,
  })
  return rows[0]
}

// ---------------------------------------------------------------- ohne Netz (nur Chip)

interface Queued {
  badge: string
  at: string
}

function readQueue(): Queued[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as Queued[]
  } catch {
    return []
  }
}

function writeQueue(q: Queued[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
  } catch {
    // Speicher voll oder gesperrt
  }
}

export const queuedCount = () => readQueue().length

export function enqueue(badge: string) {
  writeQueue([...readQueue(), { badge, at: new Date().toISOString() }])
}

// Gespeicherte Stempelungen der Reihe nach übertragen; bricht bei Netzproblemen ab.
// Liefert die Fehlermeldungen der Stempelungen, die nicht übernommen werden konnten.
export async function flushQueue(token: string) {
  const failed: string[] = []
  let q = readQueue()
  while (q.length > 0) {
    const item = q[0]
    try {
      const r = await terminalClock(token, { badge: item.badge, at: item.at })
      if (!r.ok) failed.push(`${new Date(item.at).toLocaleString('de-DE')}: ${r.message}`)
    } catch (err) {
      if (err instanceof NetworkError) break
      failed.push(`${new Date(item.at).toLocaleString('de-DE')}: ${(err as Error).message}`)
    }
    q = readQueue().slice(1)
    writeQueue(q)
  }
  return failed
}
