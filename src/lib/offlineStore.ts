// Kleine IndexedDB-Ablage für den Offline-Modus: zwischengespeicherte Antworten und
// die Warteschlange der Änderungen, die noch zum Server müssen.

const DB_NAME = 'joleka-offline'
const VERSION = 1
export type StoreName = 'cache' | 'outbox' | 'meta'

let dbPromise: Promise<IDBDatabase> | null = null

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache')
      if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true })
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode)
        const req = fn(tx.objectStore(store))
        tx.oncomplete = () => resolve(req.result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

export const idbGet = <T>(store: StoreName, key: IDBValidKey) => run<T | undefined>(store, 'readonly', (s) => s.get(key))
export const idbPut = (store: StoreName, value: unknown, key?: IDBValidKey) => run(store, 'readwrite', (s) => s.put(value, key))
export const idbDelete = (store: StoreName, key: IDBValidKey) => run(store, 'readwrite', (s) => s.delete(key))
export const idbAll = <T>(store: StoreName) => run<T[]>(store, 'readonly', (s) => s.getAll())
export const idbKeys = (store: StoreName) => run<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys())
export const idbClear = (store: StoreName) => run(store, 'readwrite', (s) => s.clear())

// Zwischengespeicherte Antworten löschen, die älter als maxAgeMs sind (Speicher klein halten)
export async function idbPruneCache(maxAgeMs: number) {
  const d = await db()
  const limit = new Date(Date.now() - maxAgeMs).toISOString()
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction('cache', 'readwrite')
    const req = tx.objectStore('cache').openCursor()
    req.onsuccess = () => {
      const cur = req.result
      if (!cur) return
      const v = cur.value as { at?: string } | string
      // signierte Foto-Links (nur Text) bleiben bis zum Abmelden
      if (typeof v === 'object' && v?.at && v.at < limit) cur.delete()
      cur.continue()
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
