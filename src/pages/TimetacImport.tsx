import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { employeeName, norm, type Employee } from '../lib/employee'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/types'
import { useProfiles } from '../lib/useProfiles'

// Einmaliger Import aus TimeTac (Fabian, 2026-10-27): 1. Mitarbeiter abgleichen, 2. Zeiten laden, 3. importieren.
// TimeTac liefert die Daten über die Funktion "timetac-import"; geschrieben wird über import_attendance.

type Row = Record<string, unknown>

async function timetac(body: Record<string, string>): Promise<Row[]> {
  const { data, error } = await supabase.functions.invoke('timetac-import', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const status = error.context.status
      const payload = await error.context.json().catch(() => null)
      throw new Error(payload?.error ?? `TimeTac-Abruf fehlgeschlagen (Fehler ${status}${status === 546 || status === 504 ? ', Zeitüberschreitung' : ''})`)
    }
    throw new Error('TimeTac-Import nicht erreichbar. Ist die Funktion „timetac-import“ in Supabase eingerichtet?')
  }
  return Array.isArray(data) ? data : []
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())

// Personalnummer: TimeTac benennt das Feld je nach Konto unterschiedlich
function ttNumber(u: Row) {
  if (str(u.personnel_number)) return str(u.personnel_number)
  for (const [k, v] of Object.entries(u)) {
    if (/personal_?n|personnel_?n|staff_?n|employee_?n|pers_?nr/i.test(k) && str(v)) return str(v)
  }
  return ''
}

const ttName = (u: Row) => [str(u.firstname), str(u.lastname)].filter(Boolean).join(' ') || str(u.username) || `#${str(u.id)}`
const nameKey = (s: string) => s.split(/[\s,;]+/).map(norm).filter(Boolean).sort().join('|')

// Formatierer je Zeitzone nur einmal anlegen (bei vielen Jahren sonst sehr langsam)
const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone)
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone: zone || 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    } catch {
      f = formatter('Europe/Berlin')
    }
    formatters.set(zone, f)
  }
  return f
}

// "2024-01-15 07:00:00" in der Zeitzone des Eintrags -> ISO (UTC)
function toIso(local: unknown, tz: unknown) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(str(local))
  if (!m) return null
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0))
  const zone = str(tz)
  if (/^[+-]\d{2}:?\d{2}$/.test(zone)) {
    const sign = zone[0] === '-' ? -1 : 1
    const [h, mi] = [+zone.slice(1, 3), +zone.slice(-2)]
    return new Date(utc - sign * (h * 60 + mi) * 60000).toISOString()
  }
  const fmt = formatter(zone)
  const offset = (t: number) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]))
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t
  }
  const t = utc - offset(utc)
  return new Date(utc - offset(t)).toISOString()
}

const day = (d: Date) => d.toISOString().slice(0, 10)
const fmtDay = (d: string) => (d ? new Date(d + 'T00:00').toLocaleDateString('de-DE') : '')

// Zeitraum in Monate teilen, damit ein Abruf nicht zu lange dauert
function months(from: string, to: string) {
  const out: [string, string][] = []
  for (let start = from; start <= to; ) {
    const d = new Date(start + 'T00:00:00Z')
    const monthEnd = day(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))
    const end = monthEnd < to ? monthEnd : to
    out.push([start, end])
    start = day(new Date(Date.parse(end + 'T00:00:00Z') + 86400000))
  }
  return out
}
const monthName = (d: string) => new Date(d + 'T00:00').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })

// TimeTac-Abwesenheitsarten -> Arten in der App (Feiertage rechnet die App selbst)
const ABSENCE_KIND: Record<string, { kind: string; label: string }> = {
  holiday: { kind: 'urlaub', label: 'Urlaub' },
  overtime_reduction: { kind: 'ueberstunden', label: 'Zeitausgleich (Überstunden)' },
  sick_leave: { kind: 'krank', label: 'Krankheit' },
  other_paid_leave: { kind: 'sonderurlaub', label: 'Sonderurlaub' },
}

interface Slim { uid: string; task: string; start: string; end: string }

interface Absence { start: string; end: string; days: number; kind: string; req: string }

// Genehmiger eines TimeTac-Antrags (TimeTac-Benutzer-ID und Zeitpunkt, UTC)
interface Grant { uid: string; at: string | null }

// Abwesenheitstage zu Zeiträumen zusammenfassen: gleicher Antrag und gleiche Art, nicht über den Jahreswechsel
function groupAbsences(rows: Row[]) {
  const per = new Map<string, Absence[]>()
  const sorted = rows
    .filter((r) => Number(r.status) === 1 && ABSENCE_KIND[str(r.type)] && Number(r.value) > 0)
    .map((r): Row & { date: string } => ({ ...r, date: str(r.date).slice(0, 10) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
  const open = new Map<string, Absence>()
  const push = (uid: string, a: Absence) => {
    const item = { start: a.start, end: a.end, days: a.days, kind: a.kind, req: a.req }
    const list = per.get(uid)
    if (list) list.push(item)
    else per.set(uid, [item])
  }
  for (const r of sorted) {
    const uid = str(r.user_id)
    const kind = ABSENCE_KIND[str(r.type)].kind
    const days = str(r.value_unit) === 'hs' ? Number(r.value) / 8 : Number(r.value)
    const cur = open.get(uid)
    if (cur && cur.kind === kind && cur.req === str(r.request_id) && cur.end.slice(0, 4) === r.date.slice(0, 4)) {
      cur.end = r.date
      cur.days += days
      continue
    }
    if (cur) push(uid, cur)
    open.set(uid, { start: r.date, end: r.date, days, kind, req: str(r.request_id) })
  }
  for (const [uid, cur] of open) push(uid, cur)
  return per
}
const STORE = 'timetac-zuordnung'

export function TimetacImport() {
  const { byId } = useProfiles()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [users, setUsers] = useState<Row[] | null>(null)
  const [map, setMap] = useState<Record<string, number | 0>>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORE) ?? '{}')
    } catch {
      return {}
    }
  })
  const [onlyActive, setOnlyActive] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [from, setFrom] = useState(() => `${new Date().getFullYear() - 1}-01-01`)
  const [to, setTo] = useState(() => day(new Date(Date.now() - 86400000)))
  const [trackings, setTrackings] = useState<Slim[] | null>(null)
  // Zeitraum, für den Zeiten bzw. Abwesenheiten geladen wurden (wird beim Import ersetzt)
  const [ttRange, setTtRange] = useState<[string, string]>(['', ''])
  const [absRange, setAbsRange] = useState<[string, string]>(['', ''])
  const [tasks, setTasks] = useState<Record<string, string>>({})
  const [skipTasks, setSkipTasks] = useState<string[]>([])
  const [absences, setAbsences] = useState<Map<string, Absence[]> | null>(null)
  const [grants, setGrants] = useState<Map<string, Grant>>(new Map())
  const [grantsError, setGrantsError] = useState('')
  const [absResult, setAbsResult] = useState<{ name: string; replaced: number; inserted: number; skipped: number; error?: string }[]>([])
  const [result, setResult] = useState<{ name: string; replaced: number; inserted: number; skipped: number; error?: string }[]>([])

  async function loadEmployees() {
    const { data } = await supabase.from('employees').select('id, user_id, personnel_number, status, first_name, last_name')
    setEmployees((data ?? []) as unknown as Employee[])
  }
  useEffect(() => {
    loadEmployees()
  }, [])

  function remember(next: Record<string, number>) {
    setMap(next)
    try {
      localStorage.setItem(STORE, JSON.stringify(next))
    } catch {
      // Zuordnung gilt dann nur bis zum Neuladen
    }
  }

  async function loadUsers() {
    setBusy('Lade Benutzer aus TimeTac …')
    setError('')
    try {
      const list = await timetac({ action: 'users' })
      setUsers(list)
      // Vorschlag: gleiche Personalnummer, sonst gleicher Name
      const byNr = new Map(employees.filter((e) => e.personnel_number).map((e) => [str(e.personnel_number), e.id]))
      const byName = new Map(employees.map((e) => [nameKey(employeeName(e)), e.id]))
      const next = { ...map }
      for (const u of list) {
        const id = str(u.id)
        if (id in next) continue
        next[id] = byNr.get(ttNumber(u)) ?? byName.get(nameKey(ttName(u))) ?? 0
      }
      remember(next)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy('')
  }

  const empById = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees])
  const shownUsers = (users ?? []).filter((u) => !onlyActive || u.active === undefined || u.active === true || u.active === 1 || u.active === '1')

  // Stammdaten einmalig abgleichen: fehlende Personalnummer ergänzen, fehlende Akten anlegen
  async function createFile(u: Row) {
    const { data, error } = await supabase
      .from('employees')
      .insert({ status: 'Aktiv', first_name: str(u.firstname), last_name: str(u.lastname), personnel_number: ttNumber(u) })
      .select('id, user_id, personnel_number, status, first_name, last_name')
      .single()
    if (error) return setError(error.message)
    setEmployees((l) => [...l, data as unknown as Employee])
    remember({ ...map, [str(u.id)]: data.id })
  }

  async function fillNumbers() {
    setBusy('Ergänze Personalnummern …')
    for (const u of shownUsers) {
      const e = empById[map[str(u.id)]]
      const nr = ttNumber(u)
      if (e && nr && !str(e.personnel_number)) {
        const { error } = await supabase.from('employees').update({ personnel_number: nr }).eq('id', e.id)
        if (error) setError(error.message)
      }
    }
    await loadEmployees()
    setBusy('')
  }

  async function loadTrackings() {
    setBusy('Lade Zeiten aus TimeTac …')
    setError('')
    setResult([])
    try {
      // nur die nötigen Felder behalten, gleich nach UTC umgerechnet
      const list: Slim[] = []
      for (const [start, end] of months(from, to)) {
        setBusy(`Lade Zeiten aus TimeTac … ${monthName(start)}`)
        for (const t of await timetac({ action: 'trackings', from: start, to: end })) {
          const s = toIso(t.start_time, t.start_time_timezone)
          const e = toIso(t.end_time, t.end_time_timezone ?? t.start_time_timezone)
          list.push({ uid: str(t.user_id), task: str(t.task_id), start: s ?? '', end: e ?? '' })
        }
      }
      const taskList = await timetac({ action: 'tasks' }).catch(() => [] as Row[])
      setTrackings(list)
      setTtRange([from, to])
      setTasks(Object.fromEntries(taskList.map((t) => [str(t.id), str(t.name) || `Aufgabe ${str(t.id)}`])))
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy('')
  }

  // Zeiten je TimeTac-Benutzer, umgerechnet nach UTC
  const perUser = useMemo(() => {
    const groups = new Map<string, Slim[]>()
    for (const t of trackings ?? []) {
      if (!t.start || !t.end || skipTasks.includes(t.task)) continue
      const list = groups.get(t.uid)
      if (list) list.push(t)
      else groups.set(t.uid, [t])
    }
    return groups
  }, [trackings, skipTasks])

  // Übersicht je Benutzer einmal berechnen, nicht bei jeder Anzeige
  const summary = useMemo(
    () =>
      [...perUser.entries()].map(([uid, rows]) => {
        let first = rows[0].start
        let last = rows[0].start
        let h = 0
        for (const r of rows) {
          if (r.start < first) first = r.start
          if (r.start > last) last = r.start
          h += (Date.parse(r.end) - Date.parse(r.start)) / 3600000
        }
        return { uid, count: rows.length, hours: h, first, last }
      }),
    [perUser],
  )

  const taskCounts = useMemo(() => {
    const c = new Map<string, number>()
    for (const t of trackings ?? []) c.set(t.task, (c.get(t.task) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1])
  }, [trackings])

  const userName = (uid: string) => {
    const u = (users ?? []).find((x) => str(x.id) === uid)
    return u ? ttName(u) : `TimeTac #${uid}`
  }

  async function runImport() {
    if (!confirm(
      `TimeTac ist führend: Alle Stempelzeiten der zugeordneten Mitarbeiter vom ${fmtDay(ttRange[0])} bis ${fmtDay(ttRange[1])} ` +
      'werden durch die Zeiten aus TimeTac ersetzt. Laufende Stempelungen bleiben stehen.\n\nJetzt importieren?',
    )) return
    setError('')
    const out: typeof result = []
    for (const [uid, rows] of perUser) {
      const e = empById[map[uid]]
      if (!e?.user_id) continue
      setBusy(`Importiere ${userName(uid)} …`)
      let inserted = 0
      let skipped = 0
      let err = ''
      const cleared = await supabase.rpc('clear_attendance', { p_user: e.user_id, p_from: ttRange[0], p_to: ttRange[1] })
      if (cleared.error) {
        err = cleared.error.message.includes('clear_attendance') ? 'Bitte zuerst das SQL-Update „TimeTac führend“ ausführen.' : cleared.error.message
        out.push({ name: employeeName(e), replaced: 0, inserted, skipped, error: err })
        setResult([...out])
        break
      }
      for (let i = 0; i < rows.length; i += 500) {
        const { data, error } = await supabase.rpc('import_attendance', {
          p_user: e.user_id,
          p_rows: rows.slice(i, i + 500).map((r) => ({ start: r.start, end: r.end, note: tasks[r.task] ?? '' })),
        })
        if (error) {
          err = error.message.includes('import_attendance') ? 'Bitte zuerst das SQL-Update für den TimeTac-Import ausführen.' : error.message
          break
        }
        inserted += data.inserted
        skipped += data.skipped
      }
      out.push({ name: employeeName(e), replaced: cleared.data ?? 0, inserted, skipped, error: err || undefined })
      setResult([...out])
      if (err) break
    }
    setBusy('')
  }

  async function loadAbsences() {
    setError('')
    setAbsResult([])
    try {
      const list: Row[] = []
      for (const [start, end] of months(from, to)) {
        setBusy(`Lade Abwesenheiten aus TimeTac … ${monthName(start)}`)
        list.push(...(await timetac({ action: 'absences', from: start, to: end })))
      }
      setBusy('Lade Genehmiger aus TimeTac …')
      // Genehmiger stehen nur im Antrag; fehlt er, wird die Abwesenheit ohne Genehmiger übernommen
      const next = new Map<string, Grant>()
      let gErr = ''
      try {
        for (const a of await timetac({ action: 'requests', from, to })) {
          const uid = str(a.granted_user_id)
          if (uid && uid !== '0') next.set(str(a.id), { uid, at: toIso(a.granted_timestamp, 'Europe/Berlin') })
        }
      } catch (e) {
        gErr = (e as Error).message
      }
      setGrants(next)
      setGrantsError(gErr)
      setAbsences(groupAbsences(list))
      setAbsRange([from, to])
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy('')
  }

  // Genehmiger eines Antrags: App-Benutzer der zugeordneten Personalakte, sonst nur der Name
  function approver(req: string) {
    const g = grants.get(req)
    if (!g) return { decided_by: null, decided_by_name: '', decided_at: null }
    const e = empById[map[g.uid]]
    if (e?.user_id) return { decided_by: e.user_id, decided_by_name: '', decided_at: g.at }
    return { decided_by: null, decided_by_name: e ? employeeName(e) : userName(g.uid), decided_at: g.at }
  }

  async function importAbsences() {
    if (!absences || !confirm(
      `TimeTac ist führend: Urlaub, Krankheit und andere Abwesenheiten der zugeordneten Mitarbeiter vom ${fmtDay(absRange[0])} bis ${fmtDay(absRange[1])} ` +
      'werden storniert und durch die genehmigten Abwesenheiten aus TimeTac ersetzt.\n\nJetzt übernehmen?',
    )) return
    setError('')
    const out: typeof absResult = []
    for (const [uid, rows] of absences) {
      const e = empById[map[uid]]
      if (!e?.user_id) continue
      setBusy(`Übernehme Abwesenheiten von ${userName(uid)} …`)
      const cleared = await supabase.rpc('clear_absences', { p_user: e.user_id, p_from: absRange[0], p_to: absRange[1] })
      const { data, error } = cleared.error ? { data: null, error: cleared.error } : await supabase.rpc('import_absences', {
            p_user: e.user_id,
            p_rows: rows.map((r) => ({ start: r.start, end: r.end, days: r.days, kind: r.kind, ...approver(r.req) })),
          })
      const err = error
        ? /import_absences|clear_absences/.test(error.message) ? 'Bitte zuerst die SQL-Updates für die Abwesenheiten und „TimeTac führend“ ausführen.' : error.message
        : ''
      out.push({ name: employeeName(e), replaced: cleared.data ?? 0, inserted: data?.inserted ?? 0, skipped: data?.skipped ?? 0, error: err || undefined })
      setAbsResult([...out])
      if (err) break
    }
    setBusy('')
  }

  const absenceSum = (rows: Absence[], kind: string) => rows.filter((r) => r.kind === kind).reduce((s, r) => s + r.days, 0)

  return (
    <div>
      <div className="page-head">
        <h1>Import aus TimeTac</h1>
        <Link to="/personal">Zurück zum Personal</Link>
      </div>
      {error && <p className="error">{error}</p>}
      {busy && <p className="muted">{busy}</p>}

      <section className="card">
        <h2>1. Mitarbeiter abgleichen</h2>
        <p className="muted small">
          Jeder TimeTac-Benutzer wird einer Personalakte zugeordnet (gleiche Personalnummer, sonst gleicher Name). Zeiten
          können nur Mitarbeiter mit App-Benutzer bekommen.
        </p>
        <div className="filters">
          <button type="button" className="primary" disabled={!!busy} onClick={loadUsers}>Benutzer aus TimeTac laden</button>
          {users && (
            <>
              <label className="small"><input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> nur aktive</label>
              <button type="button" disabled={!!busy} onClick={fillNumbers}>Fehlende Personalnummern ergänzen</button>
            </>
          )}
        </div>
        {users && (
          <div className="cal-scroll">
            <table className="import-table">
              <thead>
                <tr><th>TimeTac</th><th>Nr.</th><th>Personalakte</th><th>App-Benutzer</th></tr>
              </thead>
              <tbody>
                {shownUsers.map((u) => {
                  const id = str(u.id)
                  const e = empById[map[id]]
                  return (
                    <tr key={id}>
                      <td>{ttName(u)}</td>
                      <td>{ttNumber(u) || '–'}</td>
                      <td>
                        <select value={map[id] ?? 0} onChange={(ev) => remember({ ...map, [id]: Number(ev.target.value) })}>
                          <option value={0}>– nicht zugeordnet –</option>
                          {[...employees]
                            .sort((a, b) => String(a.last_name).localeCompare(String(b.last_name), 'de'))
                            .map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.last_name}, {x.first_name}{x.personnel_number ? ` (${x.personnel_number})` : ''}{x.status !== 'Aktiv' ? ` – ${x.status}` : ''}
                              </option>
                            ))}
                        </select>
                        {!e && <button type="button" className="link" onClick={() => createFile(u)}>Akte anlegen</button>}
                      </td>
                      <td>{e?.user_id ? (byId[e.user_id] ? displayName(byId[e.user_id]) : 'ja') : e ? <span className="error">keiner</span> : '–'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {users && (
        <section className="card">
          <h2>2. Zeiten laden</h2>
          <div className="filters">
            <label className="small">von <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="small">bis <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <button type="button" className="primary" disabled={!!busy || !from || !to || from > to} onClick={loadTrackings}>Zeiten laden</button>
          </div>
          {trackings && (
            <>
              <p className="small">{trackings.length.toLocaleString('de-DE')} Buchungen gefunden.</p>
              {taskCounts.length > 1 && (
                <>
                  <p className="muted small">Aufgaben, die nicht als Arbeitszeit zählen (z. B. Pause), abwählen:</p>
                  <div className="filters">
                    {taskCounts.map(([t, n]) => (
                      <label key={t} className="small">
                        <input
                          type="checkbox"
                          checked={!skipTasks.includes(t)}
                          onChange={(e) => setSkipTasks((s) => (e.target.checked ? s.filter((x) => x !== t) : [...s, t]))}
                        />{' '}
                        {tasks[t] ?? (t ? `Aufgabe ${t}` : 'ohne Aufgabe')} ({n})
                      </label>
                    ))}
                  </div>
                </>
              )}
              <div className="cal-scroll">
                <table className="import-table">
                  <thead>
                    <tr><th>TimeTac</th><th>Personalakte</th><th>Buchungen</th><th>Stunden</th><th>Zeitraum</th><th></th></tr>
                  </thead>
                  <tbody>
                    {summary.map(({ uid, count, hours, first, last }) => {
                      const e = empById[map[uid]]
                      return (
                        <tr key={uid} className={e?.user_id ? '' : 'muted'}>
                          <td>{userName(uid)}</td>
                          <td>{e ? employeeName(e) : '–'}</td>
                          <td>{count.toLocaleString('de-DE')}</td>
                          <td>{hours.toLocaleString('de-DE', { maximumFractionDigits: 1 })}</td>
                          <td>{new Date(first).toLocaleDateString('de-DE')} – {new Date(last).toLocaleDateString('de-DE')}</td>
                          <td className="small">{e?.user_id ? 'wird importiert' : e ? 'kein App-Benutzer' : 'nicht zugeordnet'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {trackings && (
        <section className="card">
          <h2>3. Importieren</h2>
          <p className="muted small">
            TimeTac ist führend: Vorhandene Stempelzeiten der zugeordneten Mitarbeiter im geladenen Zeitraum werden durch
            die Zeiten aus TimeTac ersetzt (laufende Stempelungen bleiben stehen). Der Import kann beliebig oft wiederholt
            werden. Importierte Zeiten tragen die Notiz „TimeTac“.
          </p>
          <button type="button" className="primary" disabled={!!busy} onClick={runImport}>Import starten</button>
          {result.length > 0 && (
            <table className="import-table">
              <thead>
                <tr><th>Mitarbeiter</th><th>ersetzt</th><th>übernommen</th><th>übersprungen</th></tr>
              </thead>
              <tbody>
                {result.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td>{r.replaced}</td>
                    <td>{r.inserted}</td>
                    <td>{r.skipped}{r.error && <span className="error"> {r.error}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!busy && result.length > 0 && <p className="small"><b>Import abgeschlossen.</b></p>}
        </section>
      )}
      {users && (
        <section className="card">
          <h2>4. Abwesenheiten</h2>
          <p className="muted small">
            Genehmigte Abwesenheiten im gleichen Zeitraum (oben bei 2. gewählt): Urlaub, Zeitausgleich, Krankheit und
            Sonderurlaub. Sie werden als genehmigt eingetragen und mindern das Soll; Urlaub zählt gegen den Anspruch. Vorhandene Abwesenheiten im Zeitraum werden durch TimeTac ersetzt.
          </p>
          <button type="button" className="primary" disabled={!!busy || !from || !to || from > to} onClick={loadAbsences}>Abwesenheiten laden</button>
          {absences && (
            <>
              <div className="cal-scroll">
                <table className="import-table">
                  <thead>
                    <tr>
                      <th>TimeTac</th><th>Personalakte</th>
                      {Object.values(ABSENCE_KIND).map((k) => <th key={k.kind}>{k.label}</th>)}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...absences.entries()].map(([uid, rows]) => {
                      const e = empById[map[uid]]
                      return (
                        <tr key={uid} className={e?.user_id ? '' : 'muted'}>
                          <td>{userName(uid)}</td>
                          <td>{e ? employeeName(e) : '–'}</td>
                          {Object.values(ABSENCE_KIND).map((k) => (
                            <td key={k.kind}>{absenceSum(rows, k.kind) ? absenceSum(rows, k.kind).toLocaleString('de-DE') : '–'}</td>
                          ))}
                          <td className="small">{e?.user_id ? 'wird importiert' : e ? 'kein App-Benutzer' : 'nicht zugeordnet'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {grantsError ? (
                <p className="error small">Genehmiger konnten nicht aus TimeTac geladen werden ({grantsError}). Die Abwesenheiten werden ohne Genehmiger übernommen.</p>
              ) : (
                <p className="muted small">Genehmiger aus TimeTac: {grants.size.toLocaleString('de-DE')} Anträge. Wer keinen App-Benutzer hat, erscheint nur mit Namen.</p>
              )}
              {absences.size === 0 && <p className="muted">Keine genehmigten Abwesenheiten in diesem Zeitraum.</p>}
              {absences.size > 0 && <button type="button" className="primary" disabled={!!busy} onClick={importAbsences}>Abwesenheiten übernehmen</button>}
            </>
          )}
          {absResult.length > 0 && (
            <table className="import-table">
              <thead>
                <tr><th>Mitarbeiter</th><th>ersetzt</th><th>übernommen</th><th>übersprungen</th></tr>
              </thead>
              <tbody>
                {absResult.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td>{r.replaced}</td>
                    <td>{r.inserted}</td>
                    <td>{r.skipped}{r.error && <span className="error"> {r.error}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!busy && absResult.length > 0 && <p className="small"><b>Abwesenheiten übernommen.</b></p>}
        </section>
      )}
    </div>
  )
}
