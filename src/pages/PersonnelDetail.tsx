import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import {
  MAIN_FIELDS,
  STATUS,
  SUBTABLE,
  TABS,
  WAGE_GROUPS,
  employeeName,
  euro,
  fullYears,
  parse,
  show,
  toInput,
  wageConcept,
  type Employee,
  type Entry,
  type Field,
  type SubTable,
  companyEmail,
  missingPayroll,
  EXTERNAL_TAB,
  isExternal,
} from '../lib/employee'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL, displayName } from '../lib/types'
import { createUser, generatePassword } from '../lib/adminUsers'
import { useProfiles } from '../lib/useProfiles'
import { Users } from './Users'
import { EmployeeHistory } from '../components/EmployeeHistory'

type Form = Record<string, string | boolean>

function formOf(e: Employee): Form {
  const f: Form = {}
  for (const field of MAIN_FIELDS) f[field.key] = field.type === 'yesno' ? !!e[field.key] : toInput(field, e[field.key])
  return f
}

// Eingabefeld je Feldart, angelehnt an das Ninox-Formular
function Input({ field, value, onChange, options }: { field: Field; value: string | boolean; onChange: (v: string | boolean) => void; options?: string[] }) {
  if (field.type === 'status') {
    const opts = field.options ?? STATUS
    return (
      <div className={`segmented ${opts.length === 2 ? 'two' : 'three'}`}>
        {opts.map((s) => (
          <button type="button" key={s} className={value === s ? 'active' : ''} onClick={() => onChange(s)}>{s}</button>
        ))}
      </div>
    )
  }
  if (field.type === 'yesno') {
    return (
      <div className="segmented two">
        <button type="button" className={value ? 'active' : ''} onClick={() => onChange(true)}>Ja</button>
        <button type="button" className={!value ? 'active' : ''} onClick={() => onChange(false)}>Nein</button>
      </div>
    )
  }
  const v = String(value ?? '')
  if (field.type === 'textarea') return <textarea rows={3} value={v} onChange={(e) => onChange(e.target.value)} />
  if (field.type === 'date') return <input type="date" value={v} onChange={(e) => onChange(e.target.value)} />
  if (field.type === 'datetime') return <input type="datetime-local" value={v} onChange={(e) => onChange(e.target.value)} />
  if (field.type === 'number' || field.type === 'money') return <input inputMode="decimal" value={v} onChange={(e) => onChange(e.target.value)} />
  if (field.type === 'choice' && options) return <ChoiceInput value={v} options={options} onChange={onChange} />
  return <input value={v} onChange={(e) => onChange(e.target.value)} />
}

// Auswahlfeld mit allen Vorschlägen. Eine datalist zeigt nur Werte, die zum aktuellen Text passen
// (bei "JOLEKA Administration" fehlte so "Geschäftsführung"); eigene Werte bleiben über "Anderer Wert …" möglich.
const OTHER = '__anderer_wert__'
function ChoiceInput({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  const [custom, setCustom] = useState(false)
  const all = value && !options.includes(value) ? [value, ...options] : options
  if (custom) {
    return (
      <div className="choice-custom">
        <input value={value} autoFocus onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="link" title="Zur Liste" onClick={() => setCustom(false)}>Liste</button>
      </div>
    )
  }
  return (
    <select value={value} onChange={(e) => (e.target.value === OTHER ? setCustom(true) : onChange(e.target.value))}>
      <option value="">–</option>
      {all.map((o) => <option key={o} value={o}>{o}</option>)}
      <option value={OTHER}>Anderer Wert …</option>
    </select>
  )
}

// Untertabelle wie in Ninox: Zeilen anklicken zum Bearbeiten, "+ Datensatz erstellen"
function SubTableView({ table, entries, employeeId, reload }: { table: SubTable; entries: Entry[]; employeeId: number; reload: () => Promise<void> }) {
  const [edit, setEdit] = useState<{ id: number | null; values: Record<string, string> } | null>(null)
  const [error, setError] = useState('')
  // Spalten aus Ninox, die die App nicht kennt, trotzdem zeigen
  const extraCols = useMemo(() => {
    const known = new Set(table.columns.map((c) => c.key))
    const keys = new Set<string>()
    for (const e of entries) for (const k of Object.keys(e.data)) if (!known.has(k)) keys.add(k)
    return [...keys].map((k): Field => ({ key: k, label: k, type: 'text' }))
  }, [entries, table])
  const cols = [...table.columns, ...extraCols]
  const sorted = useMemo(() => {
    const k = table.sortBy
    if (!k) return entries
    return [...entries].sort((a, b) => String(b.data[k] ?? '').localeCompare(String(a.data[k] ?? ''), 'de', { numeric: true }))
  }, [entries, table])

  function start(e: Entry | null) {
    setError('')
    const values: Record<string, string> = {}
    for (const c of cols) values[c.key] = toInput(c, e?.data[c.key])
    setEdit({ id: e?.id ?? null, values })
  }

  async function save() {
    if (!edit) return
    const data: Record<string, unknown> = {}
    for (const c of cols) {
      const v = parse(c, edit.values[c.key] ?? '')
      if (v !== '' && v !== null) data[c.key] = v
    }
    // Arbeitskleidung: Gesamt = Menge × EK, wenn nicht eingetragen
    if (table.kind === 'kleidung' && data.total == null && typeof data.qty === 'number' && typeof data.unit_price === 'number') {
      data.total = Math.round(data.qty * data.unit_price * 100) / 100
    }
    const res = edit.id
      ? await supabase.from('employee_entries').update({ data }).eq('id', edit.id)
      : await supabase.from('employee_entries').insert({ employee_id: employeeId, kind: table.kind, data })
    if (res.error) return setError(res.error.message)
    setEdit(null)
    await reload()
  }

  async function remove() {
    if (!edit?.id || !confirm('Diesen Datensatz löschen?')) return
    const { error } = await supabase.from('employee_entries').delete().eq('id', edit.id)
    if (error) return setError(error.message)
    setEdit(null)
    await reload()
  }

  const editor = (
    <tr className="emp-edit-row">
      <td colSpan={cols.length}>
        <div className="emp-grid">
          {cols.map((c) => (
            <label key={c.key} className={c.wide || c.type === 'textarea' ? 'wide' : ''}>
              {c.label}
              <Input field={c.type === 'file' ? { ...c, type: 'text' } : c} value={edit?.values[c.key] ?? ''} options={c.type === 'choice' ? c.options : undefined}
                onChange={(v) => setEdit((s) => (s ? { ...s, values: { ...s.values, [c.key]: String(v) } } : s))} />
            </label>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="card-head-actions">
          <button type="button" className="primary" onClick={save}>Speichern</button>
          <button type="button" onClick={() => setEdit(null)}>Abbrechen</button>
          {edit?.id && <button type="button" className="danger" onClick={remove}>Löschen</button>}
        </div>
      </td>
    </tr>
  )

  return (
    <div className="emp-sub">
      <div className="emp-sub-title">{table.title}</div>
      <div className="cal-scroll">
        <table className="import-table emp-table">
          <thead>
            <tr>{cols.map((c) => <th key={c.key} className={c.type === 'money' || c.type === 'number' ? 'num' : ''}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {sorted.map((e) =>
              edit?.id === e.id ? (
                <Fragment key={e.id}>{editor}</Fragment>
              ) : (
                <tr key={e.id} className="clickable" onClick={() => start(e)}>
                  {cols.map((c) => (
                    <td key={c.key} className={c.type === 'money' || c.type === 'number' ? 'num' : ''}>
                      {c.type === 'file' && e.data[c.key] ? '📎 ' : ''}{show(c, e.data[c.key])}
                    </td>
                  ))}
                </tr>
              ),
            )}
            {edit && edit.id === null && editor}
          </tbody>
        </table>
      </div>
      {!edit && <button type="button" className="link" onClick={() => start(null)}>+ Datensatz erstellen</button>}
    </div>
  )
}

// Krankheitstage je Jahr aus der Zeiterfassung (Abwesenheiten "Krank", z. B. aus TimeTac)
function SickDaysByYear({ employeeId, hasUser }: { employeeId: number; hasUser: boolean }) {
  const [rows, setRows] = useState<{ year: number; days: number }[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!hasUser) return
    supabase.rpc('employee_sick_days', { p_employee: employeeId }).then(({ data, error }) => {
      if (error) setError(error.message)
      setRows((data ?? []) as { year: number; days: number }[])
    })
  }, [employeeId, hasUser])

  const fmt = (n: number) => Number(n).toLocaleString('de-DE', { maximumFractionDigits: 1 })

  return (
    <div className="emp-sub">
      <div className="emp-sub-title">Krankheitstage laut Zeiterfassung</div>
      {!hasUser ? (
        <p className="muted small">Kein App-Benutzer verknüpft, daher keine Zeiterfassung.</p>
      ) : error ? (
        <p className="error">{error}</p>
      ) : rows === null ? (
        <p className="muted small">Lädt…</p>
      ) : rows.length === 0 ? (
        <p className="muted small">Keine Daten aus der Zeiterfassung vorhanden.</p>
      ) : (
        <div className="cal-scroll">
          <p className="small">
            Durchschnitt pro Jahr: <b>{fmt(rows.reduce((a, r) => a + Number(r.days), 0) / rows.length)} Tage</b>
            <span className="muted"> (über {rows.length} {rows.length === 1 ? 'Jahr' : 'Jahre'} mit Zeiterfassung)</span>
          </p>
          <table className="import-table emp-table">
            <thead>
              <tr><th>Jahr</th><th className="num">Krankheitstage</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.year}><td>{r.year}</td><td className="num">{fmt(r.days)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Personalakte eines Mitarbeiters mit den Reitern aus Ninox
export function PersonnelDetail() {
  const { id = '' } = useParams()
  const { profile: me } = useAuth()
  const { byId, reload: reloadProfiles } = useProfiles()
  const navigate = useNavigate()
  const [emp, setEmp] = useState<Employee | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [form, setForm] = useState<Form>({})
  const [wage, setWage] = useState<Record<string, boolean>>({})
  const [tab, setTab] = useState('mitarbeiter')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [options, setOptions] = useState<Record<string, string[]>>({})
  const [logVersion, setLogVersion] = useState(0)

  const loadEntries = useCallback(async () => {
    const { data } = await supabase.from('employee_entries').select('id, employee_id, kind, data').eq('employee_id', id).order('id')
    setEntries((data ?? []) as Entry[])
    setLogVersion((v) => v + 1)
  }, [id])

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('employees').select('*').eq('id', id).maybeSingle()
    if (error) setError(error.message)
    const e = (data ?? null) as Employee | null
    setEmp(e)
    if (e) {
      setForm(formOf(e))
      setWage({ ...(e.wage_concept ?? {}) })
    }
    await loadEntries()
    setLoaded(true)
  }, [id, loadEntries])

  useEffect(() => {
    load()
  }, [load])

  // Auswahl-Vorschläge: feste Werte plus alles, was bei anderen Mitarbeitern schon eingetragen ist
  useEffect(() => {
    const keys = MAIN_FIELDS.filter((f) => f.type === 'choice').map((f) => f.key)
    supabase.from('employees').select(keys.join(',')).then(({ data }) => {
      const out: Record<string, string[]> = {}
      for (const f of MAIN_FIELDS.filter((f) => f.type === 'choice')) {
        const seen = new Set(f.options ?? [])
        for (const r of (data ?? []) as unknown as Record<string, unknown>[]) if (r[f.key]) seen.add(String(r[f.key]))
        out[f.key] = [...seen]
      }
      setOptions(out)
    })
  }, [])

  const dirty = useMemo(() => {
    if (!emp) return false
    const base = formOf(emp)
    if (MAIN_FIELDS.some((f) => base[f.key] !== form[f.key])) return true
    return JSON.stringify(Object.keys(wage).filter((k) => wage[k]).sort()) !== JSON.stringify(Object.keys(emp.wage_concept ?? {}).filter((k) => emp.wage_concept[k]).sort())
  }, [emp, form, wage])

  async function save() {
    if (!emp) return
    setBusy(true)
    setError('')
    const row: Record<string, unknown> = {}
    for (const f of MAIN_FIELDS) {
      const v = form[f.key]
      if (f.type === 'yesno') row[f.key] = !!v
      else {
        const p = parse(f, String(v ?? ''))
        if ((f.type === 'number' || f.type === 'money') && typeof p === 'string') {
          setBusy(false)
          return setError(`${f.label}: bitte eine Zahl eintragen.`)
        }
        row[f.key] = p ?? (f.type === 'date' || f.type === 'number' || f.type === 'money' ? null : '')
      }
    }
    row.wage_concept = Object.fromEntries(Object.entries(wage).filter(([, v]) => v))
    const { error } = await supabase.from('employees').update(row).eq('id', emp.id)
    if (error) setError(error.message)
    // Name, Urlaub und Zugang des App-Benutzers gleicht die Datenbank an
    await Promise.all([load(), reloadProfiles()])
    setBusy(false)
  }

  // Login nach Schema vorname.nachname@joleka.de, Startpasswort wird einmal angezeigt
  async function createAccount() {
    if (!emp) return
    const first = String(form.first_name ?? '').trim()
    const last = String(form.last_name ?? '').trim()
    const external = isExternal(emp)
    if (!first || !last) return setError(external ? 'Bitte zuerst Vor- und Nachname des Ansprechpartners eintragen und speichern.' : 'Bitte zuerst Vor- und Nachname eintragen und speichern.')
    // Externe melden sich mit ihrer eigenen E-Mail-Adresse an
    const email = external ? String(emp.email ?? '').trim().toLowerCase() : companyEmail(first, last)
    if (external && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('Bitte zuerst die E-Mail-Adresse eintragen und speichern, sie wird der Login.')
    const role = external || /montage/i.test(String(form.department ?? '')) ? 'monteur' : 'mitarbeiter'
    if (!confirm(`App-Benutzer ${email} (${ROLE_LABEL[role]}) anlegen?`)) return
    setBusy(true)
    setError('')
    try {
      const password = generatePassword()
      const created = (await createUser({ email, full_name: `${first} ${last}`, role, password })) as { id: string }
      const { error } = await supabase.from('employees').update({ user_id: created.id }).eq('id', emp.id)
      if (error) throw error
      await reloadProfiles()
      await load()
      alert(`Benutzer angelegt.\n\nLogin: ${email}\nStartpasswort: ${password}\n\nBitte notieren, das Passwort wird nicht noch einmal angezeigt.`)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  async function removeEmployee() {
    if (!emp || !confirm(`${employeeName(emp)} mit allen Einträgen endgültig löschen? Ein App-Benutzer bleibt bestehen.`)) return
    const { error } = await supabase.from('employees').delete().eq('id', emp.id)
    if (error) return setError(error.message)
    navigate(isExternal(emp) ? '/personal?art=extern' : '/personal')
  }

  if (!loaded) return <p className="muted">Lädt…</p>
  if (!emp) return <p className="error">{error || 'Mitarbeiter nicht gefunden.'}</p>

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))
  const byKind = (k: string) => entries.filter((e) => e.kind === k)
  const age = fullYears(String(form.birth_date || '') || null)
  const seniority = fullYears(String(form.entry_date || '') || null)
  const wc = wageConcept(wage, String(form.entry_date || '') || null)
  const user = emp.user_id ? byId[emp.user_id] : null
  const external = isExternal(emp)
  const own = external ? [EXTERNAL_TAB] : TABS
  const tabs = me?.role === 'admin' ? [...own, { key: 'benutzer', title: 'App-Benutzer', sections: [] }] : own
  const current = tabs.find((t) => t.key === tab) ?? own[0]

  function toggleWage(groupIdx: number, key: string, on: boolean) {
    const g = WAGE_GROUPS[groupIdx]
    setWage((w) => {
      const next = { ...w, [key]: on }
      if (on && g.single) for (const i of g.items) if (i.key !== key) next[i.key] = false
      if (on && g.alternative) {
        const inAlt = g.alternative.some((i) => i.key === key)
        for (const i of inAlt ? g.items : g.alternative) next[i.key] = false
      }
      return next
    })
  }

  return (
    <div className="emp-page">
      <div className="page-head">
        <h1>{employeeName(emp)}</h1>
        <Link to={external ? '/personal?art=extern' : '/personal'}>← {external ? 'Externe Dienstleister' : 'Personal'}</Link>
      </div>
      <p className="muted small">
        App-Benutzer: {user ? `${displayName(user)} · ${user.email}` : 'keiner'}
      </p>
      <nav className="emp-tabs">
        {tabs.map((t) => (
          <button type="button" key={t.key} className={t.key === tab ? 'active' : ''} onClick={() => setTab(t.key)}>{t.title}</button>
        ))}
      </nav>
      {error && <p className="error">{error}</p>}

      {current.key === 'benutzer' &&
        (emp.user_id ? (
          <Users key={emp.user_id} only={emp.user_id} onChanged={() => { reloadProfiles(); load() }} />
        ) : (
          <section className="card">
            <p>{employeeName(emp)} hat noch keinen App-Benutzer.</p>
            <p className="muted small">
              {external
                ? `Login ist die E-Mail-Adresse aus den Stammdaten${emp.email ? ` (${emp.email})` : ''}, das Startpasswort wird einmal angezeigt.`
                : 'Login nach dem Schema vorname.nachname@joleka.de, das Startpasswort wird einmal angezeigt.'}
            </p>
            <button type="button" className="primary" disabled={busy} onClick={createAccount}>App-Benutzer anlegen</button>
          </section>
        ))}

      {current.key === 'mitarbeiter' && (() => {
        const missing = missingPayroll(emp, entries.some((x) => x.kind === 'lohn'), emp.user_id && byId[emp.user_id] ? !!byId[emp.user_id].supervisor_id : null)
        return missing.length > 0 && (
          <p className="emp-missing small">
            <b>Es fehlen noch Pflichtangaben:</b> {missing.join(', ')}
          </p>
        )
      })()}

      {current.key !== 'benutzer' && <section className="card emp-card">
        {current.key === 'fehlzeiten' && (
          <div className="emp-section">
            <SickDaysByYear employeeId={emp.id} hasUser={!!emp.user_id} />
          </div>
        )}
        {current.sections.map((s, i) => (
          <div key={i} className="emp-section">
            {s.title && <h3 className="emp-heading">{s.title}</h3>}
            {(s.fields?.length || s.computed?.length) ? (
              <div className="emp-grid">
                {s.fields?.map((f) => (
                  <label key={f.key} className={f.wide ? 'wide' : f.type === 'status' ? 'wide' : ''}>
                    {f.label}
                    <Input field={f} value={form[f.key] ?? ''} options={f.type === 'choice' ? options[f.key] ?? f.options ?? [] : undefined} onChange={(v) => set(f.key, v)} />
                  </label>
                ))}
                {s.computed?.includes('age') && (
                  <label>Alter<input readOnly value={age != null ? `${age} Jahre` : ''} /></label>
                )}
                {s.computed?.includes('seniority') && (
                  <label>Betriebszugehörigkeit<input readOnly value={seniority != null ? `${seniority} Jahre` : ''} /></label>
                )}
              </div>
            ) : null}
            {s.tables?.map((k) => (
              <SubTableView key={k} table={SUBTABLE[k]} entries={byKind(k)} employeeId={emp.id} reload={loadEntries} />
            ))}
          </div>
        ))}

        {current.key === 'lohnkonzept' && (
          <div className="emp-section">
            <div className="emp-grid wage-top">
              <label>Lohn / Gehalt nach neuem LK<input readOnly value={euro(wc.base)} /></label>
              <label>Berechnung Betriebszugehörigkeit / Erfahrung<input readOnly value={euro(wc.seniority)} /></label>
              <label>Stundenlohn Summe<input readOnly value={euro(wc.total)} /></label>
              <button type="button" className="danger" onClick={() => setWage({})}>Daten löschen</button>
            </div>
            {WAGE_GROUPS.map((g, gi) => (
              <div key={g.title}>
                <h3 className="wage-head">{g.title}</h3>
                <div className="wage-items">
                  {g.items.map((it) => (
                    <label key={it.key} className="checkbox-row">
                      <input type="checkbox" checked={!!wage[it.key]} onChange={(e) => toggleWage(gi, it.key, e.target.checked)} />
                      {it.label} ({euro(it.amount)})
                    </label>
                  ))}
                </div>
                {g.alternative && (
                  <>
                    <div className="wage-or">oder:</div>
                    <div className="wage-items">
                      {g.alternative.map((it) => (
                        <label key={it.key} className="checkbox-row">
                          <input type="checkbox" checked={!!wage[it.key]} onChange={(e) => toggleWage(gi, it.key, e.target.checked)} />
                          {it.label} ({euro(it.amount)})
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>}

      {dirty && (
        <div className="emp-savebar">
          <span>Ungespeicherte Änderungen</span>
          <button type="button" onClick={() => { setForm(formOf(emp)); setWage({ ...(emp.wage_concept ?? {}) }); load() }}>Verwerfen</button>
          <button type="button" className="primary" disabled={busy} onClick={save}>{busy ? 'Speichert…' : 'Speichern'}</button>
        </div>
      )}

      <EmployeeHistory employeeId={emp.id} version={logVersion} />

      {me?.role === 'admin' && (
        <p><button type="button" className="danger" onClick={removeEmployee}>{external ? 'Externen Dienstleister löschen' : 'Mitarbeiter löschen'}</button></p>
      )}
    </div>
  )
}
