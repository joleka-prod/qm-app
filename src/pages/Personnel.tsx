import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { STATUS, employeeName, isExternal, isManagingDirector, missingPayroll, norm, type Employee } from '../lib/employee'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/types'
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
// Durchschnittsalter mit Geschäftsführung; Krankheitstage ohne Geschäftsführung als Mittel der
// Jahresdurchschnitte je Mitarbeiter (wie im Reiter Fehlzeiten), damit kurze Zugehörigkeit nicht verzerrt.
function KeyFigures({ list }: { list: Employee[] }) {
  type Sick = { avg_days: number; cur_days: number | null }
  const [sick, setSick] = useState<Map<number, Sick> | null>(null)
  const [sickError, setSickError] = useState('')

  useEffect(() => {
    supabase.rpc('employees_sick_days_avg').then(({ data, error }) => {
      if (error) setSickError(error.message.includes('employees_sick_days_avg') ? 'SQL-Update fehlt' : error.message)
      const rows = (data ?? []) as ({ employee_id: number } & Sick)[]
      setSick(new Map(rows.map((r) => [r.employee_id, { avg_days: Number(r.avg_days), cur_days: r.cur_days == null ? null : Number(r.cur_days) }])))
    })
  }, [])

  const active = list.filter((e) => e.status === 'Aktiv')
  const now = Date.now()
  const year = new Date().getFullYear()
  const ages = active.filter((e) => e.birth_date).map((e) => (now - new Date(String(e.birth_date) + 'T00:00').getTime()) / (365.2425 * 864e5))
  const sickRows = active.filter((e) => !isManagingDirector(e) && sick?.has(e.id)).map((e) => sick!.get(e.id)!)
  const sickAvgs = sickRows.map((r) => r.avg_days)
  // laufendes Geschäftsjahr (= Kalenderjahr), Stand heute
  const sickCur = sickRows.filter((r) => r.cur_days !== null).map((r) => r.cur_days!)
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
  const sickValue = (a: number[]) => (sickError ? '–' : sick === null ? '…' : a.length ? `${num(avg(a))} Tage` : '–')

  return (
    <div className="key-figures">
      <section className="card key-figure">
        <div className="muted small">Durchschnittsalter</div>
        <div className="key-figure-value">{ages.length ? `${num(avg(ages))} Jahre` : '–'}</div>
        <div className="muted small">
          {ages.length} aktive Mitarbeiter{ages.length < active.length ? `, ${active.length - ages.length} ohne Geburtsdatum` : ''}
        </div>
      </section>
      <section className="card key-figure">
        <div className="muted small">Ø Krankheitstage pro Jahr (historisch)</div>
        <div className="key-figure-value">{sickValue(sickAvgs)}</div>
        <div className="muted small">
          {sickError || `je Mitarbeiter über alle Jahre, ${sickAvgs.length} aktive Mitarbeiter mit Zeiterfassung, ohne Geschäftsführung`}
        </div>
      </section>
      <section className="card key-figure">
        <div className="muted small">Ø Krankheitstage {year} (bis heute)</div>
        <div className="key-figure-value">{sickValue(sickCur)}</div>
        <div className="muted small">
          {sickError || `je Mitarbeiter im laufenden Geschäftsjahr, ${sickCur.length} aktive Mitarbeiter mit Zeiterfassung, ohne Geschäftsführung`}
        </div>
      </section>
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

// Menüpunkt Personal: Mitarbeiter, externe Dienstleister (Fabian, 2026-10-27) und (nur Admin) App-Benutzer mit Stempel-Terminals
export function Personnel() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const users = profile?.role === 'admin' && params.get('ansicht') === 'benutzer'
  const external = !users && params.get('art') === 'extern'
  return (
    <div>
      <nav className="emp-tabs">
        <button type="button" className={users || external ? '' : 'active'} onClick={() => setParams({})}>Mitarbeiter</button>
        <button type="button" className={external ? 'active' : ''} onClick={() => setParams({ art: 'extern' })}>Externe Dienstleister</button>
        {profile?.role === 'admin' && (
          <button type="button" className={users ? 'active' : ''} onClick={() => setParams({ ansicht: 'benutzer' })}>Stempel-Terminals</button>
        )}
      </nav>
      {users ? <Users /> : external ? <ExternalList /> : <EmployeeList />}
    </div>
  )
}

// Übersicht externe Dienstleister: nur Stammdaten und App-Benutzer, keine Pflichtangaben für die Lohnabrechnung
function ExternalList() {
  const { byId } = useProfiles()
  const navigate = useNavigate()
  const [list, setList] = useState<Employee[]>([])
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string>('Aktiv')

  useEffect(() => {
    supabase.from('employees').select('*').eq('employee_type', 'extern').then(({ data, error }) => {
      if (error) setError(error.message.includes('employee_type') ? 'Bitte zuerst das SQL-Update für externe Dienstleister ausführen.' : error.message)
      setList((data ?? []) as unknown as Employee[])
    })
  }, [])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return list
      .filter((e) => !status || e.status === status)
      .filter((e) => !needle || [e.company, e.first_name, e.last_name, e.trade, e.city].some((s) => String(s ?? '').toLowerCase().includes(needle)))
      .sort((a, b) => employeeName(a).localeCompare(employeeName(b), 'de'))
  }, [list, q, status])

  async function create() {
    const { data, error } = await supabase.from('employees').insert({ status: 'Aktiv', employee_type: 'extern' }).select('id').single()
    if (error) setError(error.message)
    else navigate(`/personal/${data.id}`)
  }

  return (
    <div>
      <div className="page-head">
        <h1>Externe Dienstleister</h1>
        <div className="card-head-actions">
          <button className="primary" onClick={create}>+ Externer Dienstleister</button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="filters">
        <input type="search" placeholder="Firma, Ansprechpartner, Gewerk, Ort…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="Aktiv">Aktiv</option>
          <option value="nicht aktiv">nicht aktiv</option>
          <option value="">Alle</option>
        </select>
      </div>
      <section className="card">
        <div className="cal-scroll">
          <table className="import-table">
            <thead>
              <tr><th>Firma</th><th>Ansprechpartner</th><th>Gewerk / Tätigkeit</th><th>Telefon</th><th>Ort</th><th>App-Benutzer</th></tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} className={e.status === 'Aktiv' ? '' : 'muted'}>
                  <td><Link to={`/personal/${e.id}`}>{String(e.company || '') || 'Ohne Firma'}</Link></td>
                  <td>{[e.first_name, e.last_name].filter(Boolean).join(' ') || '–'}</td>
                  <td>{String(e.trade || '–')}</td>
                  <td>{String(e.mobile || e.phone || '–')}</td>
                  <td>{String(e.city || '–')}</td>
                  <td>{e.user_id ? (byId[e.user_id] ? `${displayName(byId[e.user_id])} (${byId[e.user_id].email})` : 'ja') : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && <p className="muted">Keine Einträge.</p>}
      </section>
    </div>
  )
}

// Übersicht Personalakten (nur Admin und Benutzer mit Zugriff auf Personalakten)
function EmployeeList() {
  const { profile } = useAuth()
  const { byId } = useProfiles()
  const navigate = useNavigate()
  const [list, setList] = useState<Employee[]>([])
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string>('Aktiv')

  const [skip, setSkip] = useState<string[]>(ignored)
  const [busy, setBusy] = useState(false)

  const [withWage, setWithWage] = useState<Set<number>>(new Set())
  const [showMissing, setShowMissing] = useState(false)

  const load = useCallback(async () => {
    const [{ data, error }, wages] = await Promise.all([
      supabase.from('employees').select('*'),
      supabase.from('employee_entries').select('employee_id').eq('kind', 'lohn'),
    ])
    if (error) setError(error.message.includes('employees') ? 'Bitte zuerst das SQL-Update für das Personal ausführen.' : error.message)
    // externe Dienstleister stehen in einer eigenen Liste
    setList(((data ?? []) as unknown as Employee[]).filter((e) => !isExternal(e)))
    setWithWage(new Set((wages.data ?? []).map((w) => w.employee_id as number)))
  }, [])

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

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return list
      .filter((e) => !status || e.status === status)
      .filter((e) => !needle || [employeeName(e), e.personnel_number, e.department].some((s) => String(s ?? '').toLowerCase().includes(needle)))
      .sort((a, b) => String(a.last_name).localeCompare(String(b.last_name), 'de') || String(a.first_name).localeCompare(String(b.first_name), 'de'))
  }, [list, q, status])

  async function create() {
    const { data, error } = await supabase.from('employees').insert({ status: 'Aktiv' }).select('id').single()
    if (error) setError(error.message)
    else navigate(`/personal/${data.id}`)
  }

  return (
    <div>
      <div className="page-head">
        <h1>Personal</h1>
        <div className="card-head-actions">
          {profile?.role === 'admin' && <Link to="/personal/timetac" className="button">Import aus TimeTac</Link>}
          <button className="primary" onClick={create}>+ Mitarbeiter</button>
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
        <input type="search" placeholder="Name, Personalnummer, Abteilung…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
          <option value="">Alle</option>
        </select>
      </div>
      <section className="card">
        <div className="cal-scroll">
          <table className="import-table">
            <thead>
              <tr><th>Nr.</th><th>Name</th><th>Status</th><th>Abteilung</th><th>Firmeneintritt</th><th>App-Benutzer</th></tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} className={e.status === 'Aktiv' ? '' : 'muted'}>
                  <td>{String(e.personnel_number || '–')}</td>
                  <td><Link to={`/personal/${e.id}`}>{e.last_name || e.first_name ? `${e.last_name}, ${e.first_name}` : employeeName(e)}</Link></td>
                  <td>{String(e.status)}</td>
                  <td>{String(e.department || '–')}</td>
                  <td>{fmt(e.entry_date)}</td>
                  <td>{e.user_id ? (byId[e.user_id] ? `${displayName(byId[e.user_id])} (${byId[e.user_id].email})` : 'ja') : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && <p className="muted">Keine Einträge.</p>}
      </section>
    </div>
  )
}
