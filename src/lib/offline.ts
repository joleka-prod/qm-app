import { useEffect, useSyncExternalStore } from 'react'
import { idbAll, idbClear, idbDelete, idbGet, idbPruneCache, idbPut } from './offlineStore'

// Offline-Modus (Fabian, 2026-10-26): Monteure arbeiten auch auf Baustellen ohne Empfang.
// Alle Anfragen von supabase-js laufen über offlineFetch:
// - Lesen: zuerst Netz, die Antwort wird im Handy gespeichert. Ohne Netz kommt die gespeicherte Antwort.
// - Ausgewählte Änderungen (Positionen, Bericht, Erledigt, Unterschrift, Fotos, Stempeln, Bericht-Mail)
//   landen ohne Netz in einer Warteschlange und werden bei Empfang der Reihe nach übertragen.
// Noch nicht übertragene Änderungen an Auftrag und Positionen werden beim Lesen eingerechnet.

const nativeFetch: typeof fetch = (...args) => window.fetch(...args)
const READ_TIMEOUT = 15000

// ---------------------------------------------------------------- Zustand

export interface FailedOp {
  label: string
  message: string
  at: string
}

interface StoredBody {
  kind: 'none' | 'text' | 'blob' | 'form'
  text?: string
  blob?: Blob
  form?: [string, string | Blob, string | undefined][]
}

export interface QueuedOp {
  id?: number
  user: string
  at: string
  method: string
  url: string
  headers: Record<string, string>
  body: StoredBody
  label: string
  // für "Speichern" sichtbare Änderungen (Datei-Uploads zählen nicht extra)
  visible: boolean
}

interface State {
  online: boolean
  pending: number
  failed: FailedOp[]
  syncing: boolean
  savedAt: string | null
}

let state: State = { online: navigator.onLine, pending: 0, failed: [], syncing: false, savedAt: null }
let queue: QueuedOp[] = []
let user = ''
let getToken: () => Promise<string | null> = async () => null
const listeners = new Set<() => void>()

function setState(patch: Partial<State>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function refreshPending() {
  setState({ pending: queue.filter((o) => o.user === user && o.visible).length })
}

export function useOfflineState() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

const SYNCED = 'offline-synced'

// Seiten laden neu, sobald wartende Änderungen beim Server angekommen sind
export function useOfflineSynced(fn: () => void) {
  useEffect(() => {
    window.addEventListener(SYNCED, fn)
    return () => window.removeEventListener(SYNCED, fn)
  }, [fn])
}

const ready = (async () => {
  try {
    queue = await idbAll<QueuedOp>('outbox')
    setState({
      failed: (await idbGet<FailedOp[]>('meta', 'failed')) ?? [],
      savedAt: (await idbGet<string>('meta', 'savedAt')) ?? null,
    })
    await idbPruneCache(14 * 24 * 60 * 60 * 1000)
  } catch {
    // ohne IndexedDB (z. B. privates Fenster) arbeitet die App wie bisher nur online
  }
})()

export function configureOffline(tokenGetter: () => Promise<string | null>) {
  getToken = tokenGetter
}

// Angemeldeter Benutzer: Zwischenspeicher und Warteschlange gehören immer einem Benutzer
export function setOfflineUser(id: string | null) {
  user = id ?? ''
  refreshPending()
  if (user) void flush()
}

export async function clearOfflineCache() {
  await idbClear('cache').catch(() => undefined)
  await idbPut('meta', null, 'savedAt').catch(() => undefined)
  setState({ savedAt: null })
}

export async function markSaved() {
  const at = new Date().toISOString()
  await idbPut('meta', at, 'savedAt').catch(() => undefined)
  setState({ savedAt: at })
}

export async function dismissFailed() {
  await idbPut('meta', [], 'failed').catch(() => undefined)
  setState({ failed: [] })
}

// Wartende Aufrufe einer Funktion (z. B. Stempeluhr), für die Anzeige vor der Übertragung
export function pendingRpc(fn: string): { at: string; args: Record<string, unknown> }[] {
  return queue
    .filter((o) => o.user === user && new URL(o.url).pathname === `/rest/v1/rpc/${fn}`)
    .map((o) => ({ at: o.at, args: o.body.text ? (JSON.parse(o.body.text) as Record<string, unknown>) : {} }))
}

// Fotos eines Auftrags, die noch auf die Übertragung warten
export function pendingPhotos(ticketId: number) {
  return queue.filter(
    (o) => o.user === user && new URL(o.url).pathname === '/rest/v1/ticket_photos' && o.body.text?.includes(`"ticket_id":${ticketId}`),
  ).length
}

export function isOffline() {
  return !navigator.onLine || !state.online
}

function goneOffline() {
  if (state.online) setState({ online: false })
}

function backOnline() {
  if (!state.online) setState({ online: true })
}

window.addEventListener('online', () => {
  backOnline()
  tokenRetries = 0
  void flush()
})
window.addEventListener('offline', goneOffline)
setInterval(() => {
  if (queue.some((o) => o.user === user)) void flush()
}, 30000)

// ---------------------------------------------------------------- Einordnung der Anfragen

type Kind = 'read' | 'sign' | 'queue' | 'pass'

const READ_RPCS = ['ticket_chain', 'overtime_balance', 'vacation_workdays']
const QUEUE_RPCS = ['clock_in', 'clock_out', 'start_time_entry', 'stop_time_entry']

function classify(url: URL, method: string): Kind {
  const p = url.pathname
  // Personalakten nie im Handy-Speicher ablegen
  if (p.startsWith('/rest/v1/personnel_') || p.includes('/personnel-docs/')) return 'pass'
  if (method === 'GET' && p.startsWith('/rest/v1/')) return 'read'
  if (method !== 'POST' && method !== 'PATCH') return 'pass'
  if (p.startsWith('/storage/v1/object/sign/')) return method === 'POST' ? 'sign' : 'pass'
  const rpc = p.match(/^\/rest\/v1\/rpc\/(\w+)$/)?.[1]
  if (rpc) return READ_RPCS.includes(rpc) ? 'read' : QUEUE_RPCS.includes(rpc) ? 'queue' : 'pass'
  if (method === 'PATCH' && /^\/rest\/v1\/(tickets|ticket_positions)$/.test(p)) return 'queue'
  if (method === 'POST' && /^\/rest\/v1\/(ticket_photos|ticket_positions)$/.test(p)) return 'queue'
  if (method === 'POST' && p.startsWith('/storage/v1/object/ticket-photos/')) return 'queue'
  if (method === 'POST' && p === '/functions/v1/send-report') return 'queue'
  return 'pass'
}

function labelFor(url: URL, method: string, text: string): { label: string; visible: boolean } {
  const p = url.pathname
  if (p.startsWith('/storage/')) return { label: p.includes('/unterschrift-') ? 'Unterschrift (Bild)' : 'Foto (Datei)', visible: false }
  if (p.endsWith('/rpc/clock_in')) return { label: 'Zeiterfassung gestartet', visible: true }
  if (p.endsWith('/rpc/clock_out')) return { label: 'Zeiterfassung gestoppt', visible: true }
  if (p.endsWith('/rpc/start_time_entry')) return { label: 'Auftragszeit gestartet', visible: true }
  if (p.endsWith('/rpc/stop_time_entry')) return { label: 'Auftragszeit gestoppt', visible: true }
  if (p.startsWith('/functions/')) return { label: 'Servicebericht per E-Mail', visible: true }
  if (p.endsWith('/ticket_photos')) return { label: 'Foto', visible: true }
  if (p.endsWith('/ticket_positions')) return { label: method === 'POST' ? 'Position ergänzt' : 'Position bewertet', visible: true }
  if (text.includes('"abgeschlossen"')) return { label: 'Einsatz als erledigt gemeldet', visible: true }
  if (text.includes('signature_path')) return { label: 'Kundenunterschrift', visible: true }
  if (text.includes('work_report')) return { label: 'Arbeitsbericht', visible: true }
  return { label: 'Auftrag geändert', visible: true }
}

// ---------------------------------------------------------------- Hilfsfunktionen

function urlOf(input: RequestInfo | URL) {
  return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href)
}

async function storeBody(body: BodyInit | null | undefined): Promise<StoredBody> {
  if (body == null) return { kind: 'none' }
  if (typeof body === 'string') return { kind: 'text', text: body }
  if (body instanceof FormData) {
    const form: StoredBody['form'] = []
    body.forEach((v, k) => form.push([k, v, v instanceof File ? v.name : undefined]))
    return { kind: 'form', form }
  }
  if (body instanceof Blob) return { kind: 'blob', blob: body }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return { kind: 'blob', blob: new Blob([body as BlobPart]) }
  return { kind: 'text', text: String(body) }
}

function restoreBody(b: StoredBody): BodyInit | undefined {
  if (b.kind === 'text') return b.text
  if (b.kind === 'blob') return b.blob
  if (b.kind === 'form') {
    const f = new FormData()
    for (const [k, v, name] of b.form ?? []) {
      if (typeof v === 'string') f.append(k, v)
      else f.append(k, v, name)
    }
    return f
  }
  return undefined
}

function headerObject(h: HeadersInit | undefined) {
  const out: Record<string, string> = {}
  new Headers(h).forEach((v, k) => {
    if (k !== 'authorization') out[k] = v
  })
  return out
}

function withTimeout(init: RequestInit | undefined, ms: number): RequestInit {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  init?.signal?.addEventListener('abort', () => ctrl.abort())
  ctrl.signal.addEventListener('abort', () => clearTimeout(timer))
  return { ...init, signal: ctrl.signal }
}

function isNetworkError(err: unknown, init?: RequestInit) {
  // vom Aufrufer abgebrochen ist kein Netzfehler
  if (init?.signal?.aborted) return false
  return err instanceof TypeError || (err instanceof DOMException && err.name === 'AbortError')
}

// ---------------------------------------------------------------- Lesen

interface CachedResponse {
  status: number
  headers: Record<string, string>
  body: string
  at: string
}

const KEEP_HEADERS = ['content-type', 'content-range', 'preference-applied']

// Wartende Änderungen an Auftrag und Positionen in gelesene Daten einrechnen
function applyPending(url: URL, body: string): string {
  const table = url.pathname.match(/^\/rest\/v1\/(tickets|ticket_positions)$/)?.[1]
  if (!table) return body
  const patches = queue.filter((o) => o.user === user && o.method === 'PATCH' && new URL(o.url).pathname === url.pathname)
  if (patches.length === 0) return body
  try {
    const data = JSON.parse(body) as unknown
    const rows = (Array.isArray(data) ? data : [data]) as Record<string, unknown>[]
    for (const op of patches) {
      const id = Number(new URL(op.url).searchParams.get('id')?.replace(/^eq\./, ''))
      const patch = JSON.parse(op.body.text ?? '{}') as Record<string, unknown>
      for (const row of rows) if (row && row.id === id) Object.assign(row, patch)
    }
    return JSON.stringify(data)
  } catch {
    return body
  }
}

async function cachedResponse(key: string, url: URL): Promise<Response | null> {
  const hit = await idbGet<CachedResponse>('cache', key).catch(() => undefined)
  if (!hit) return null
  return new Response(applyPending(url, hit.body), { status: hit.status, headers: { ...hit.headers, 'x-offline-cache': hit.at } })
}

async function read(url: URL, init: RequestInit | undefined, bodyText: string): Promise<Response> {
  const key = `${user}|${init?.method ?? 'GET'}|${url.href}|${bodyText}`
  if (!navigator.onLine) {
    const hit = await cachedResponse(key, url)
    if (hit) return hit
    throw new TypeError('Offline und nicht im Handy gespeichert')
  }
  let res: Response
  try {
    res = await nativeFetch(url.href, withTimeout(init, READ_TIMEOUT))
  } catch (err) {
    if (!isNetworkError(err, init)) throw err
    goneOffline()
    const hit = await cachedResponse(key, url)
    if (hit) return hit
    throw err
  }
  backOnline()
  if (res.status === 401) {
    // Zugang gerade abgelaufen (kam aus dem Offline-Betrieb): gespeicherten Stand zeigen, bis er erneuert ist
    const hit = await cachedResponse(key, url)
    if (hit) return hit
  }
  if (!res.ok || !user) return res
  const text = await res.text()
  const headers: Record<string, string> = {}
  for (const h of KEEP_HEADERS) {
    const v = res.headers.get(h)
    if (v) headers[h] = v
  }
  await idbPut('cache', { status: res.status, headers, body: text, at: new Date().toISOString() } satisfies CachedResponse, key).catch(
    () => undefined,
  )
  return new Response(applyPending(url, text), { status: res.status, headers })
}

// Signierte Foto-Links werden je Datei gemerkt, damit sie offline in jeder Zusammenstellung da sind
async function sign(url: URL, init: RequestInit | undefined, bodyText: string): Promise<Response> {
  const paths = (JSON.parse(bodyText || '{}') as { paths?: string[] }).paths ?? []
  const bucket = url.pathname.replace('/storage/v1/object/sign/', '')
  const keyOf = (p: string) => `${user}|sign|${bucket}/${p}`
  const fromCache = async () => {
    const items = await Promise.all(
      paths.map(async (p) => ({ path: p, signedURL: (await idbGet<string>('cache', keyOf(p)).catch(() => undefined)) ?? null, error: null })),
    )
    return new Response(JSON.stringify(items), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (!navigator.onLine) return fromCache()
  let res: Response
  try {
    res = await nativeFetch(url.href, withTimeout(init, READ_TIMEOUT))
  } catch (err) {
    if (!isNetworkError(err, init)) throw err
    goneOffline()
    return fromCache()
  }
  backOnline()
  if (!res.ok || !user) return res
  const text = await res.text()
  try {
    for (const item of JSON.parse(text) as { path: string; signedURL: string | null }[]) {
      if (item.signedURL) await idbPut('cache', item.signedURL, keyOf(item.path))
    }
  } catch {
    // Zwischenspeichern ist optional
  }
  return new Response(text, { status: res.status, headers: { 'content-type': 'application/json' } })
}

// ---------------------------------------------------------------- Schreiben

function synthetic(url: URL, method: string): Response {
  const p = url.pathname
  if (p.startsWith('/storage/v1/object/')) {
    const key = p.replace('/storage/v1/object/', '')
    return new Response(JSON.stringify({ Key: key, Id: crypto.randomUUID() }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (p.startsWith('/functions/')) {
    return new Response(JSON.stringify({ queued: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (p.startsWith('/rest/v1/rpc/')) return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } })
  return new Response(null, { status: method === 'POST' ? 201 : 204 })
}

async function enqueue(url: URL, init: RequestInit | undefined): Promise<Response> {
  const method = init?.method ?? 'GET'
  const body = await storeBody(init?.body)
  const op: QueuedOp = {
    user,
    at: new Date().toISOString(),
    method,
    url: url.href,
    headers: headerObject(init?.headers),
    body,
    ...labelFor(url, method, body.text ?? ''),
  }
  op.id = Number(await idbPut('outbox', op))
  queue.push(op)
  refreshPending()
  return synthetic(url, method)
}

async function write(url: URL, init: RequestInit | undefined): Promise<Response> {
  await ready
  // solange noch etwas wartet, hinten anstellen, damit die Reihenfolge stimmt
  if (!user || (navigator.onLine && !queue.some((o) => o.user === user))) {
    try {
      const res = await nativeFetch(url.href, init)
      backOnline()
      return res
    } catch (err) {
      if (!user || !isNetworkError(err, init)) throw err
      goneOffline()
      return enqueue(url, init)
    }
  }
  const res = await enqueue(url, init)
  void flush()
  return res
}

// ---------------------------------------------------------------- Übertragen

let flushing: Promise<void> | null = null
let tokenRetries = 0

export function flush(): Promise<void> {
  flushing ??= doFlush().finally(() => {
    flushing = null
  })
  return flushing
}

function errorText(body: string, status: number) {
  try {
    const j = JSON.parse(body) as { message?: string; error?: string; msg?: string }
    return j.message ?? j.error ?? j.msg ?? `Fehler ${status}`
  } catch {
    return body.slice(0, 200) || `Fehler ${status}`
  }
}

async function doFlush() {
  await ready
  const mine = queue.filter((o) => o.user === user)
  if (!user || mine.length === 0 || !navigator.onLine) return
  setState({ syncing: true })
  let synced = 0
  const failedPaths: string[] = []
  const failed: FailedOp[] = []
  try {
    for (const op of mine) {
      const token = await getToken()
      if (!token) {
        // Zugang wird nach dem Wiederverbinden gerade erneuert: gleich noch einmal versuchen
        if (tokenRetries++ < 5) setTimeout(() => void flush(), 3000)
        break
      }
      tokenRetries = 0
      const fail = async (message: string) => {
        failed.push({ label: op.label, message, at: op.at })
        const path = new URL(op.url).pathname
        if (path.startsWith('/storage/')) failedPaths.push(path.split('/').slice(5).join('/'))
        await remove(op)
      }
      // gehört zu einer Datei, die nicht hochgeladen werden konnte (Foto, Unterschrift)
      if (failedPaths.some((p) => op.body.text?.includes(p))) {
        await fail('Die zugehörige Datei konnte nicht übertragen werden')
        continue
      }
      let res: Response
      try {
        res = await send(op, token, op.body)
        if (res.status === 404 && op.body.text?.includes('"p_at"') && (await res.clone().text()).includes('PGRST202')) {
          // Datenbank noch ohne Offline-Zeitstempel: ohne Uhrzeit vom Handy übertragen
          const args = JSON.parse(op.body.text) as Record<string, unknown>
          delete args.p_at
          res = await send(op, token, { kind: 'text', text: JSON.stringify(args) })
        }
      } catch {
        goneOffline()
        break
      }
      backOnline()
      const text = res.ok ? '' : await res.text()
      if (res.ok || (op.url.includes('/storage/') && /Duplicate|already exists/i.test(text))) {
        synced++
        await remove(op)
      } else if (res.status >= 500 || res.status === 401 || res.status === 408 || res.status === 429) {
        break
      } else {
        await fail(errorText(text, res.status))
      }
    }
  } finally {
    if (failed.length) {
      const all = [...state.failed, ...failed]
      await idbPut('meta', all, 'failed').catch(() => undefined)
      setState({ failed: all })
    }
    refreshPending()
    setState({ syncing: false })
    if (synced > 0 || failed.length > 0) window.dispatchEvent(new Event(SYNCED))
  }
}

function send(op: QueuedOp, token: string, body: StoredBody) {
  const headers: Record<string, string> = { ...op.headers, authorization: `Bearer ${token}` }
  // FormData setzt den Content-Type mit Boundary selbst
  if (body.kind === 'form') delete headers['content-type']
  return nativeFetch(op.url, { method: op.method, headers, body: restoreBody(body) })
}

async function remove(op: QueuedOp) {
  if (op.id != null) await idbDelete('outbox', op.id).catch(() => undefined)
  queue = queue.filter((o) => o !== op)
}

// ---------------------------------------------------------------- fetch für supabase-js

export async function offlineFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = urlOf(input)
  const method = (init?.method ?? 'GET').toUpperCase()
  const kind = classify(url, method)
  if (kind === 'pass') return nativeFetch(input, init)
  await ready
  if (kind === 'queue') return write(url, init)
  const bodyText = typeof init?.body === 'string' ? init.body : ''
  return kind === 'sign' ? sign(url, init, bodyText) : read(url, init, bodyText)
}
