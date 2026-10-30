import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { MAIN_FIELDS, STATUS, TABS, employeeName, isExternal, isManagingDirector, missingPayroll, norm, parse, show, toInput, type Employee, type Field } from '../lib/employee'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL, displayName, type Profile } from '../lib/types'
import { useProfiles } from '../lib/useProfiles'
import { Users } from './Users'

const fmt = (d: unknown) => (d ? new Date(String(d) + 'T00:00').toLocaleDateString('de-DE') : '–')

// Mögliche Doppelte: gleiche Namensteile (auch vertauscht oder alles in einem Feld) oder gleiche Personalnummer
function duplicateGroups(list: Employee[]) {
  const parent = new Map<number, number>()
  const find = (x: number): number => (parent.get(x) === x ? x : find(parent.get(x)!))
  for (const e of list) parent.set(e.id, e.id)
  const seen = new Map<string, number>()
  for (const e of list) {
    // alle Namensteile egal in welchem Feld: "Zimmer Thomas" im Nachnamen = Vorname Thomas + Nachname Zimmer
    const parts = `${e.first_name ?? ''} ${e.last_name ?? ''}`.split(/[\s,;]+/).map(norm).filter(Boolean)
    const keys = [parts.length >= 2 ? 'n:' + parts.sort().join('|') : '', e.personnel_number ? 'p:' + String(e.personnel_number).trim() : ''].filter(Boolean)
    for (const k of keys) {
      if (seen.has(k)) parent.set(find(e.id), find(seen.get(k)!))
      else seen.set(k, e.id)
    }
  }
  const groups = new Map<number, Employee[]>()
  for (const e of list) groups.set(find(e.id), [...(groups.get(find(e.id)) ?? []), e])
  return [...groups.values()].filter((g) => g.length > 1)
}

const num = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

// Kennzahlen oben in der Übersicht (Fabian, 2026-10-27), nur aktive Mitarbeiter (ohne Externe):
// Durchschnittsalter mit Geschäftsführung. Quoten nach Tagen ohne Geschäftsführung (Fabian, 2026-10-30):
// Fehlzeitenquote = Fehltage (Krank, Sonderurlaub; ohne Urlaub) / Soll-Arbeitstage × 100,
// Krankenquote = Krankheitstage / Soll-Arbeitstage × 100; jeweils Summen über alle Mitarbeiter.
// Die Quoten zählen alle Mitarbeiter, auch ausgetretene (bis zum Austritt) und langzeitkranke.
function KeyFigures({ list }: { list: Employee[] }) {
  type Days = { sick: number; absent: number; possible: number }
  type Rate = { all: Days; cur: Days | null }
  const [rates, setRates] = useState<Map<number, Rate> | null>(null)
  const [rateError, setRateError] = useState('')

  useEffect(() => {
    supabase.rpc('employees_absence_rate').then(({ data, error }) => {
      if (error) setRateError(error.message.includes('employees_absence_rate') ? 'SQL-Update fehlt' : error.message)
      type Row = { employee_id: number; sick_days: number; absent_days: number; possible_days: number
        cur_sick_days: number | null; cur_absent_days: number | null; cur_possible_days: number | null }
      setRates(new Map(((data ?? []) as Row[]).map((r) => [r.employee_id, {
        all: { sick: Number(r.sick_days), absent: Number(r.absent_days), possible: Number(r.possible_days) },
        cur: r.cur_possible_days == null ? null
          : { sick: Number(r.cur_sick_days ?? 0), absent: Number(r.cur_absent_days ?? 0), possible: Number(r.cur_possible_days) },
      }])))
    })
  }, [])

  const active = list.filter((e) => e.status === 'Aktiv')
  const now = Date.now()
  const year = new Date().getFullYear()
  const ages = active.filter((e) => e.birth_date).map((e) => (now - new Date(String(e.birth_date) + 'T00:00').getTime()) / (365.2425 * 864e5))
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
  const rateRows = list.filter((e) => !isManagingDirector(e) && rates?.has(e.id)).map((e) => rates!.get(e.id)!)
  const all = rateRows.map((r) => r.all).filter((d) => d.possible > 0)
  // laufendes Geschäftsjahr (= Kalenderjahr), Stand heute
  const cur = rateRows.map((r) => r.cur).filter((d): d is Days => !!d && d.possible > 0)
  const sum = (a: Days[], k: keyof Days) => a.reduce((x, r) => x + r[k], 0)
  const rateValue = (a: Days[], k: 'sick' | 'absent') =>
    rateError ? '–' : rates === null ? '…' : a.length ? `${num((sum(a, k) / sum(a, 'possible')) * 100)} %` : '–'
  const rateNote = (a: Days[], k: 'sick' | 'absent', what: string) =>
    rateError ||
    `${num(sum(a, k))} ${k === 'sick' ? 'Krankheitstage' : 'Fehltage (Krank, Sonderurlaub)'} von ${sum(a, 'possible').toLocaleString('de-DE')} Soll-Arbeitstagen ${what}, ${a.length} Mitarbeiter mit Zeiterfassung (auch ausgetretene), ohne Geschäftsführung`
  const figures: [string, Days[], 'sick' | 'absent', string][] = [
    ['Fehlzeitenquote (historisch)', all, 'absent', 'über alle Jahre'],
    [`Fehlzeitenquote ${year} (bis heute)`, cur, 'absent', 'im laufenden Geschäftsjahr'],
    ['Krankenquote (historisch)', all, 'sick', 'über alle Jahre'],
    [`Krankenquote ${year} (bis heute)`, cur, 'sick', 'im laufenden Geschäftsjahr'],
  ]

  return (
    <div className="key-figures">
      <section className="card key-figure">
        <div className="muted small">Durchschnittsalter</div>
        <div className="key-figure-value">{ages.length ? `${num(avg(ages))} Jahre` : '–'}</div>
        <div className="muted small">
          {ages.length} aktive Mitarbeiter{ages.length < active.length ? `, ${active.length - ages.length} ohne Geburtsdatum` : ''}
        </div>
      </section>
      {figures.map(([label, days, k, what]) => (
        <section key={label} className="card key-figure">
          <div className="muted small">{label}</div>
          <div className="key-figure-value">{rateValue(days, k)}</div>
          <div className="muted small">{rateNote(days, k, what)}</div>
        </section>
      ))}
    </div>
  )
}

const IGNORE_KEY = 'personal-keine-doppelten'
const groupKey = (g: Employee[]) => g.map((e) => e.id).sort((a, b) => a - b).join('-')
function ignored(): string[] {
  try {
    return JSON.parse(localStorage.getItem(IGNORE_KEY) ?? '[]')
  } catch {
    return []
  }
}

// Spalten der Personaltabelle frei wählbar (Fabian, 2026-10-29); Auswahl je Benutzer im Browser gespeichert.
// Name ist immer sichtbar. Auswahl gegliedert wie die Personalakte (Reiter Stammdaten mit seinen Abschnitten,
// Reiter App-Benutzer), innerhalb alphabetisch, nur Nr. steht vorn (Fabian, 2026-10-29).
// field: Feld der Personalakte, im Bearbeiten-Modus direkt in der Tabelle änderbar
type Column = { key: string; label: string; group?: string; num?: boolean; field?: Field; value: (e: Employee, byId: Record<string, Profile>) => string }

const APP_USER = 'App-Benutzer'
// Abschnitt der Personalakte je Feld; Abschnitte ohne Überschrift heißen "Allgemein"
const SECTION_OF = new Map<string, string>()
for (const sec of TABS[0].sections) {
  const title = sec.title ?? 'Allgemein'
  for (const f of sec.fields ?? []) SECTION_OF.set(f.key, title)
  for (const c of sec.computed ?? []) SECTION_OF.set(c === 'age' ? 'age' : 'seniority', title)
}
const GROUPS = [...new Set([...TABS[0].sections.map((sec) => sec.title ?? 'Allgemein'), APP_USER])]

const yearsSince = (d: unknown) =>
  d ? Math.floor((Date.now() - new Date(String(d).slice(0, 10) + 'T00:00').getTime()) / (365.2425 * 864e5)) : null

const FIELD_COLUMNS: Column[] = MAIN_FIELDS
  .filter((f) => !['first_name', 'last_name', 'company'].includes(f.key))
  .map((f) => ({
    key: f.key,
    label: f.label.replace(/:$/, ''),
    num: f.type === 'number' || f.type === 'money',
    field: f,
    value: (e) => show(f, e[f.key]) || '–',
  }))

// Angaben aus dem App-Benutzer (Reiter App-Benutzer der Personalakte)
const userColumn = (key: string, label: string, value: (p: Profile, byId: Record<string, Profile>) => string): Column => ({
  key,
  label,
  group: APP_USER,
  value: (e, byId) => (e.user_id && byId[e.user_id] ? value(byId[e.user_id], byId) : '–'),
})

const COLUMNS = ([
  ...FIELD_COLUMNS,
  {
    key: 'app_user',
    label: 'App-Benutzer',
    group: APP_USER,
    value: (e, byId) => (e.user_id ? (byId[e.user_id] ? `${displayName(byId[e.user_id])} (${byId[e.user_id].email})` : 'ja') : '–'),
  },
  userColumn('role', 'Rolle', (p) => ROLE_LABEL[p.role] ?? p.role),
  userColumn('supervisor', 'Vorgesetzte(r)', (p, byId) => (p.supervisor_id && byId[p.supervisor_id] ? displayName(byId[p.supervisor_id]) : '–')),
  userColumn('montage_capacity', 'Zählt bei Kapazitätsplanung', (p) => (p.role === 'monteur' ? ((p.montage_capacity ?? true) ? 'Ja' : 'Nein') : '–')),
  { key: 'age', label: 'Alter', num: true, value: (e) => { const y = yearsSince(e.birth_date); return y === null ? '–' : `${y} Jahre` } },
  { key: 'seniority', label: 'Betriebszugehörigkeit', num: true, value: (e) => { const y = yearsSince(e.entry_date); return y === null ? '–' : `${y} Jahre` } },
] as Column[])
  .map((c) => ({ ...c, group: c.group ?? SECTION_OF.get(c.key) ?? 'Allgemein', ...(c.key === 'personnel_number' ? { label: 'Nr.' } : {}) }))
  .sort((a, b) =>
    GROUPS.indexOf(a.group!) - GROUPS.indexOf(b.group!) ||
    (a.key === 'personnel_number' ? -1 : b.key === 'personnel_number' ? 1 : a.label.localeCompare(b.label, 'de')))
const FIELD = Object.fromEntries(MAIN_FIELDS.map((f) => [f.key, f])) as Record<string, Field>
// berechnete Spalten: im Bearbeiten-Modus wird das zugrunde liegende Datum geändert
const EDIT_VIA: Record<string, string> = { age: 'birth_date', seniority: 'entry_date' }
const PROFILE_EDIT = ['role', 'supervisor', 'montage_capacity']

const nameOf = (e: Employee) => (e.last_name || e.first_name ? `${e.last_name}, ${e.first_name}` : employeeName(e))
const NAME_COLUMN: Column = { key: 'name', label: 'Name', value: nameOf }
// nur bei den externen Mitarbeitern, immer sichtbar
const COMPANY_FIELD = MAIN_FIELDS.find((f) => f.key === 'company')!
const COMPANY_COLUMN: Column = { key: 'company', label: 'Firma', field: COMPANY_FIELD, value: (e) => String(e.company || '') || '–' }
// Spalten mit wenigen verschiedenen Werten bekommen im Kopf eine Auswahl, alle anderen ein Suchfeld
const MAX_CHOICES = 15

const DEFAULT_COLUMNS = ['personnel_number', 'status', 'department', 'entry_date', 'app_user']

const columnsKey = (userId?: string) => `personal-spalten:${userId ?? ''}`
function savedColumns(userId?: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(columnsKey(userId)) ?? 'null')
    return Array.isArray(v) ? v.filter((k) => COLUMNS.some((c) => c.key === k)) : DEFAULT_COLUMNS
  } catch {
    return DEFAULT_COLUMNS
  }
}

// Zelle im Bearbeiten-Modus (Fabian, 2026-10-29): speichert beim Verlassen des Feldes bzw. bei Auswahl
// direkt in der Personalakte. Esc verwirft die Eingabe.
function EditCell({ e, field, options, onSaved }: { e: Employee; field: Field; options?: string[]; onSaved: (value: unknown) => void }) {
  const initial = field.type === 'yesno' || field.type === 'check' ? (e[field.key] ? 'ja' : 'nein') : toInput(field, e[field.key])
  const [v, setV] = useState(initial)
  const [state, setState] = useState<'' | 'busy' | 'ok' | 'error'>('')
  const [msg, setMsg] = useState('')

  async function save(next: string) {
    if (next === initial) return
    let value: unknown
    if (field.type === 'yesno' || field.type === 'check') value = next === 'ja'
    else {
      value = parse(field, next)
      if ((field.type === 'number' || field.type === 'money') && typeof value === 'string') {
        setState('error')
        return setMsg('Bitte eine Zahl eintragen.')
      }
      if (value === null && !['date', 'number', 'money'].includes(field.type)) value = ''
    }
    setState('busy')
    const { error } = await supabase.from('employees').update({ [field.key]: value }).eq('id', e.id)
    if (error) {
      setState('error')
      setMsg(error.message)
    } else {
      setState('ok')
      setMsg('')
      onSaved(value)
    }
  }

  const common = {
    className: `cell-edit ${state}`,
    title: msg || field.label,
    'aria-label': field.label,
    disabled: state === 'busy',
  }
  if (field.type === 'status' || field.type === 'yesno' || field.type === 'check' || (field.type === 'choice' && options)) {
    const opts = field.type === 'status' ? [...STATUS] : field.type === 'yesno' || field.type === 'check' ? ['ja', 'nein'] : options!
    const all = v && !opts.includes(v) ? [v, ...opts] : opts
    return (
      <select {...common} value={v} onChange={(ev) => { setV(ev.target.value); void save(ev.target.value) }}>
        {field.type !== 'status' && field.type !== 'yesno' && field.type !== 'check' && <option value="">–</option>}
        {all.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  return (
    <input
      {...common}
      type={field.type === 'date' ? 'date' : 'text'}
      inputMode={field.type === 'number' || field.type === 'money' ? 'decimal' : undefined}
      placeholder={field.label}
      value={v}
      onChange={(ev) => { setV(ev.target.value); setState('') }}
      onBlur={() => void save(v)}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur()
        if (ev.key === 'Escape') { setV(initial); setState('') }
      }}
    />
  )
}

// App-Benutzer-Angabe im Bearbeiten-Modus (Rolle, Vorgesetzte(r), Kapazitätsplanung): speichert direkt im Profil.
// Die Regeln der Datenbank gelten wie in der Benutzerverwaltung (z. B. eigene Rolle nicht änderbar).
function ProfileCell({ p, field, label, value, options, onSaved }: {
  p: Profile
  field: 'role' | 'supervisor_id' | 'montage_capacity'
  label: string
  value: string
  options: { value: string; label: string }[]
  onSaved: () => void
}) {
  const [v, setV] = useState(value)
  const [state, setState] = useState<'' | 'busy' | 'ok' | 'error'>('')
  const [msg, setMsg] = useState('')

  async function save(next: string) {
    setV(next)
    setState('busy')
    const val = field === 'montage_capacity' ? next === 'ja' : field === 'supervisor_id' ? next || null : next
    const { error } = await supabase.from('profiles').update({ [field]: val }).eq('id', p.id)
    if (error) {
      setV(value)
      setState('error')
      setMsg(error.message)
    } else {
      setState('ok')
      setMsg('')
      onSaved()
    }
  }

  return (
    <select className={`cell-edit ${state}`} title={msg || label} aria-label={label} disabled={state === 'busy'} value={v} onChange={(ev) => void save(ev.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

// Menüpunkt Personal: Mitarbeiter, externe Mitarbeiter (Fabian, 2026-10-30) und (nur Admin) App-Benutzer mit Stempel-Terminals
export function Personnel() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const users = profile?.role === 'admin' && params.get('ansicht') === 'benutzer'
  const external = !users && params.get('art') === 'extern'
  return (
    <div>
      <nav className="emp-tabs">
        <button type="button" className={users || external ? '' : 'active'} onClick={() => setParams({})}>Mitarbeiter</button>
        <button type="button" className={external ? 'active' : ''} onClick={() => setParams({ art: 'extern' })}>Externe Mitarbeiter</button>
        {profile?.role === 'admin' && (
          <button type="button" className={users ? 'active' : ''} onClick={() => setParams({ ansicht: 'benutzer' })}>Stempel-Terminals</button>
        )}
      </nav>
      {users ? <Users /> : <EmployeeList key={external ? 'extern' : 'intern'} external={external} />}
    </div>
  )
}

// Übersicht Personalakten (nur Admin und Benutzer mit Zugriff auf Personalakten);
// external: Liste der externen Mitarbeiter, gleich aufgebaut, zusätzlich mit Spalte Firma
function EmployeeList({ external }: { external: boolean }) {
  const { profile } = useAuth()
  const { profiles, byId, reload: reloadProfiles } = useProfiles()
  const navigate = useNavigate()
  const [list, setList] = useState<Employee[]>([])
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string>('Aktiv')

  const [skip, setSkip] = useState<string[]>(ignored)
  const [busy, setBusy] = useState(false)

  const [withWage, setWithWage] = useState<Set<number>>(new Set())
  const [showMissing, setShowMissing] = useState(false)

  const [colKeys, setColKeys] = useState<string[]>(() => savedColumns(profile?.id))
  const [pickCols, setPickCols] = useState(false)
  const [editing, setEditing] = useState(false)
  const cols = useMemo(() => COLUMNS.filter((c) => colKeys.includes(c.key)), [colKeys])
  const tableCols = useMemo(
    () => [
      ...cols.filter((c) => c.key === 'personnel_number'),
      NAME_COLUMN,
      ...(external ? [COMPANY_COLUMN] : []),
      ...cols.filter((c) => c.key !== 'personnel_number'),
    ],
    [cols, external],
  )
  // Filter im Spaltenkopf (Fabian, 2026-10-29); gelten nur für sichtbare Spalten
  const [colFilter, setColFilter] = useState<Record<string, string>>({})

  function chooseColumns(next: string[]) {
    setColKeys(next)
    try {
      localStorage.setItem(columnsKey(profile?.id), JSON.stringify(next))
    } catch {
      // ohne Speicher gilt die Auswahl nur bis zum Neuladen
    }
  }

  const load = useCallback(async () => {
    const [{ data, error }, wages] = await Promise.all([
      supabase.from('employees').select('*'),
      supabase.from('employee_entries').select('employee_id').eq('kind', 'lohn'),
    ])
    if (error) setError(error.message.includes('employees') ? 'Bitte zuerst das SQL-Update für das Personal ausführen.' : error.message)
    // Mitarbeiter und externe Mitarbeiter stehen in getrennten Listen
    setList(((data ?? []) as unknown as Employee[]).filter((e) => isExternal(e) === external))
    setWithWage(new Set((wages.data ?? []).map((w) => w.employee_id as number)))
  }, [external])

  const incomplete = useMemo(
    () =>
      list
        .map((e) => ({ e, missing: missingPayroll(e, withWage.has(e.id), e.user_id && byId[e.user_id] ? !!byId[e.user_id].supervisor_id : null) }))
        .filter((x) => x.missing.length > 0)
        .sort((a, b) => String(a.e.last_name).localeCompare(String(b.e.last_name), 'de')),
    [list, withWage, byId],
  )

  useEffect(() => {
    load()
  }, [load])

  const dupes = useMemo(() => duplicateGroups(list).filter((g) => !skip.includes(groupKey(g))), [list, skip])

  async function merge(keep: Employee, group: Employee[]) {
    const others = group.filter((e) => e.id !== keep.id)
    const users = group.filter((e) => e.user_id).length
    if (!confirm(
      `${employeeName(keep)} (Nr. ${keep.personnel_number || '–'}) behalten und ${others.length} weitere Akte(n) hineinführen?\n\n` +
      'Leere Felder werden ergänzt, alle Einträge (Lohn, Kinder, Schulungen …) übernommen, die anderen Akten gelöscht.' +
      (users > 1 ? '\n\nAchtung: Mehrere Akten haben einen App-Benutzer. Nur einer bleibt verknüpft, die anderen stehen danach unter „App-Benutzer ohne Personalakte“.' : ''),
    )) return
    setBusy(true)
    setError('')
    for (const o of others) {
      const { error } = await supabase.rpc('merge_employees', { p_keep: keep.id, p_drop: o.id })
      if (error) {
        setError(error.message.includes('merge_employees') ? 'Bitte zuerst das SQL-Update zum Zusammenführen ausführen.' : error.message)
        break
      }
    }
    await load()
    setBusy(false)
  }

  function notDuplicate(g: Employee[]) {
    const next = [...skip, groupKey(g)]
    setSkip(next)
    try {
      localStorage.setItem(IGNORE_KEY, JSON.stringify(next))
    } catch {
      // ohne Speicher erscheint der Hinweis beim nächsten Mal wieder
    }
  }

  const byStatus = useMemo(() => list.filter((e) => !status || e.status === status), [list, status])

  const choices = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const c of tableCols) {
      const vals = [...new Set(byStatus.map((e) => c.value(e, byId)))]
      if (c.key !== 'name' && vals.length <= MAX_CHOICES) m.set(c.key, vals.sort((a, b) => a.localeCompare(b, 'de', { numeric: true })))
    }
    return m
  }, [tableCols, byStatus, byId])

  // Vorschläge für Auswahlfelder im Bearbeiten-Modus: feste Werte plus alles, was schon eingetragen ist
  const fieldOptions = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const f of MAIN_FIELDS.filter((f) => f.type === 'choice')) {
      const seen = new Set(f.options ?? [])
      for (const e of list) if (e[f.key]) seen.add(String(e[f.key]))
      out[f.key] = [...seen]
    }
    return out
  }, [list])

  const activeProfiles = useMemo(
    () => profiles.filter((p) => p.active).sort((a, b) => displayName(a).localeCompare(displayName(b), 'de')),
    [profiles],
  )

  // Name im Bearbeiten-Modus: Nachname und Vorname getrennt, Link zur Akte bleibt dahinter
  const editName = (e: Employee) => (
    <div className="cell-name-edit">
      <EditCell e={e} field={FIELD.last_name} onSaved={(v) => saved(e.id, 'last_name', v)} />
      <EditCell e={e} field={FIELD.first_name} onSaved={(v) => saved(e.id, 'first_name', v)} />
      <Link to={`/personal/${e.id}`} title="Personalakte öffnen">↗</Link>
    </div>
  )

  function editProfile(e: Employee, c: Column) {
    const p = e.user_id ? byId[e.user_id] : undefined
    if (!p) return <span className="muted small">kein App-Benutzer</span>
    if (c.key === 'role') {
      const opts = (Object.keys(ROLE_LABEL) as (keyof typeof ROLE_LABEL)[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))
      return <ProfileCell p={p} field="role" label={c.label} value={p.role} options={opts} onSaved={reloadProfiles} />
    }
    if (c.key === 'supervisor') {
      const opts = [{ value: '', label: '–' }, ...activeProfiles.filter((o) => o.id !== p.id).map((o) => ({ value: o.id, label: displayName(o) }))]
      return <ProfileCell p={p} field="supervisor_id" label={c.label} value={p.supervisor_id ?? ''} options={opts} onSaved={reloadProfiles} />
    }
    // Kapazitätsplanung gilt nur für Monteure
    if (p.role !== 'monteur') return <span className="muted small">nur Monteure</span>
    return (
      <ProfileCell p={p} field="montage_capacity" label={c.label} value={(p.montage_capacity ?? true) ? 'ja' : 'nein'}
        options={[{ value: 'ja', label: 'Ja' }, { value: 'nein', label: 'Nein' }]} onSaved={reloadProfiles} />
    )
  }

  const saved = (id: number, key: string, value: unknown) =>
    setList((l) => l.map((x) => (x.id === id ? ({ ...x, [key]: value } as Employee) : x)))

  const activeFilters = useMemo(() => tableCols.filter((c) => colFilter[c.key]), [tableCols, colFilter])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return byStatus
      .filter((e) => !needle || [employeeName(e), e.personnel_number, e.department, e.company].some((s) => String(s ?? '').toLowerCase().includes(needle)))
      .filter((e) =>
        activeFilters.every((c) => {
          const v = c.value(e, byId)
          return choices.has(c.key) ? v === colFilter[c.key] : v.toLowerCase().includes(colFilter[c.key].trim().toLowerCase())
        }),
      )
      .sort((a, b) => String(a.last_name).localeCompare(String(b.last_name), 'de') || String(a.first_name).localeCompare(String(b.first_name), 'de'))
  }, [byStatus, q, activeFilters, choices, colFilter, byId])

  async function create() {
    const { data, error } = await supabase.from('employees').insert({ status: 'Aktiv', employee_type: external ? 'extern' : 'mitarbeiter' }).select('id').single()
    if (error) setError(error.message)
    else navigate(`/personal/${data.id}`)
  }

  return (
    <div>
      <div className="page-head">
        <h1>{external ? 'Externe Mitarbeiter' : 'Personal'}</h1>
        <div className="card-head-actions">
          {profile?.role === 'admin' && !external && <Link to="/personal/timetac" className="button">Import aus TimeTac</Link>}
          <button className="primary" onClick={create}>{external ? '+ Externer Mitarbeiter' : '+ Mitarbeiter'}</button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <KeyFigures list={list} />
      {dupes.length > 0 && (
        <section className="card">
          <h2>Mögliche doppelte Mitarbeiter ({dupes.length})</h2>
          <p className="muted small">Gleicher Name oder gleiche Personalnummer. Wähle die Akte, die bleiben soll; die anderen werden hineingeführt.</p>
          {dupes.map((g) => (
            <div key={groupKey(g)} className="cal-scroll dupe-group">
              <table className="import-table">
                <thead>
                  <tr><th>Nr.</th><th>Name</th><th>Status</th><th>Geburtsdatum</th><th>Firmeneintritt</th><th>App-Benutzer</th><th></th></tr>
                </thead>
                <tbody>
                  {g.map((e) => (
                    <tr key={e.id}>
                      <td>{String(e.personnel_number || '–')}</td>
                      <td><Link to={`/personal/${e.id}`}>{employeeName(e)}</Link></td>
                      <td>{String(e.status)}</td>
                      <td>{fmt(e.birth_date)}</td>
                      <td>{fmt(e.entry_date)}</td>
                      <td>{e.user_id ? (byId[e.user_id]?.email ?? 'ja') : '–'}</td>
                      <td><button type="button" disabled={busy} onClick={() => merge(e, g)}>Diese behalten</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" className="link" onClick={() => notDuplicate(g)}>Keine Doppelten, ausblenden</button>
            </div>
          ))}
        </section>
      )}
      {incomplete.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Fehlende Pflichtangaben ({incomplete.length})</h2>
            <button type="button" className="link" onClick={() => setShowMissing(!showMissing)}>{showMissing ? 'ausblenden' : 'anzeigen'}</button>
          </div>
          {showMissing && (
            <div className="cal-scroll">
              <table className="import-table">
                <thead>
                  <tr><th>Mitarbeiter</th><th>Status</th><th>Es fehlt</th></tr>
                </thead>
                <tbody>
                  {incomplete.map(({ e, missing }) => (
                    <tr key={e.id}>
                      <td><Link to={`/personal/${e.id}`}>{e.last_name || e.first_name ? `${e.last_name}, ${e.first_name}` : employeeName(e)}</Link></td>
                      <td>{String(e.status)}</td>
                      <td className="small">{missing.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      <div className="filters">
        <input type="search" placeholder={external ? 'Name, Firma, Personalnummer, Abteilung…' : 'Name, Personalnummer, Abteilung…'} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
          <option value="">Alle</option>
        </select>
        <button type="button" onClick={() => setPickCols(!pickCols)}>Spalten ({cols.length + 1})</button>
        <button type="button" className={editing ? 'primary' : ''} onClick={() => setEditing(!editing)}>{editing ? 'Bearbeiten beenden' : 'Bearbeiten'}</button>
      </div>
      {pickCols && (
        <section className="card">
          <div className="card-head">
            <h2>Spalten auswählen</h2>
            <div className="card-head-actions">
              <button type="button" className="link" onClick={() => chooseColumns(COLUMNS.map((c) => c.key))}>Alle</button>
              <button type="button" className="link" onClick={() => chooseColumns([])}>Keine</button>
              <button type="button" className="link" onClick={() => chooseColumns(DEFAULT_COLUMNS)}>Standard</button>
              <button type="button" onClick={() => setPickCols(false)}>Fertig</button>
            </div>
          </div>
          <p className="muted small">Der Name wird immer angezeigt. Deine Auswahl bleibt in diesem Browser gespeichert.</p>
          {GROUPS.map((g) => (
            <div key={g} className="column-group">
              <h3>{g}</h3>
              <div className="column-picker">
                {g === 'Allgemein' && <label className="checkbox"><input type="checkbox" checked disabled /> Name</label>}
                {COLUMNS.filter((c) => c.group === g).map((c) => (
                  <label key={c.key} className="checkbox">
                    <input
                      type="checkbox"
                      checked={colKeys.includes(c.key)}
                      onChange={(ev) => chooseColumns(ev.target.checked ? [...colKeys, c.key] : colKeys.filter((k) => k !== c.key))}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
      <section className="card">
        {editing && (
          <p className="muted small">
            Änderungen werden beim Verlassen des Feldes (oder mit Enter) direkt in der Personalakte gespeichert, Esc verwirft die Eingabe.
            Bei Alter und Betriebszugehörigkeit änderst du Geburtsdatum bzw. Firmeneintritt. Rolle, Vorgesetzte(r) und
            Kapazitätsplanung werden im App-Benutzer gespeichert; den App-Benutzer selbst verknüpfst du in der Personalakte.
          </p>
        )}
        <div className="cal-scroll">
          <table className="import-table">
            <thead>
              <tr>
                {tableCols.map((c) => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}
              </tr>
              <tr className="column-filters">
                {tableCols.map((c) => {
                  const set = (v: string) => setColFilter({ ...colFilter, [c.key]: v })
                  const opts = choices.get(c.key)
                  return (
                    <th key={c.key}>
                      {opts ? (
                        <select value={colFilter[c.key] ?? ''} onChange={(ev) => set(ev.target.value)} aria-label={`Filter ${c.label}`}>
                          <option value="">Alle</option>
                          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input type="search" value={colFilter[c.key] ?? ''} onChange={(ev) => set(ev.target.value)} placeholder="Filter…" aria-label={`Filter ${c.label}`} />
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} className={e.status === 'Aktiv' ? '' : 'muted'}>
                  {tableCols.map((c) =>
                    c.key === 'name'
                      ? <td key={c.key}>{editing ? editName(e) : <Link to={`/personal/${e.id}`}>{nameOf(e)}</Link>}</td>
                      : editing && EDIT_VIA[c.key]
                        ? <td key={c.key}><EditCell e={e} field={FIELD[EDIT_VIA[c.key]]} onSaved={(v) => saved(e.id, EDIT_VIA[c.key], v)} /></td>
                      : editing && PROFILE_EDIT.includes(c.key)
                        ? <td key={c.key}>{editProfile(e, c)}</td>
                      : editing && c.field
                        ? <td key={c.key}><EditCell e={e} field={c.field} options={fieldOptions[c.key]} onSaved={(v) => saved(e.id, c.key, v)} /></td>
                        : <td key={c.key} className={c.num ? 'num' : ''}>{c.value(e, byId)}</td>,
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && <p className="muted">Keine Einträge.</p>}
        {activeFilters.length > 0 && (
          <p className="muted small">
            {shown.length} von {byStatus.length} Einträgen, gefiltert nach {activeFilters.map((c) => c.label).join(', ')}.{' '}
            <button type="button" className="link" onClick={() => setColFilter({})}>Filter zurücksetzen</button>
          </p>
        )}
      </section>
    </div>
  )
}
