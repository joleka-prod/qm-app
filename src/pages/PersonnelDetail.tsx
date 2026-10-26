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
} from '../lib/employee'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL, displayName } from '../lib/types'
import { createUser, generatePassword } from '../lib/adminUsers'
import { useProfiles } from '../lib/useProfiles'

type Form = Record<string, string | boolean>

function formOf(e: Employee): Form {
  const f: Form = {}
  for (const field of MAIN_FIELDS) f[field.key] = field.type === 'yesno' ? !!e[field.key] : toInput(field, e[field.key])
  return f
}

// Eingabefeld je Feldart, angelehnt an das Ninox-Formular
function Input({ field, value, onChange, list }: { field: Field; value: string | boolean; onChange: (v: string | boolean) => void; list?: string }) {
  if (field.type === 'status') {
    return (
      <div className="segmented three">
        {STATUS.map((s) => (
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
  return <input value={v} list={list} onChange={(e) => onChange(e.target.value)} />
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
              {c.type === 'choice' && c.options && (
                <datalist id={`opt-${table.kind}-${c.key}`}>{c.options.map((o) => <option key={o} value={o} />)}</datalist>
              )}
              <Input field={c.type === 'file' ? { ...c, type: 'text' } : c} value={edit?.values[c.key] ?? ''} list={c.options ? `opt-${table.kind}-${c.key}` : undefined}
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
  const [extra, setExtra] = useState<Record<string, string>>({})
  const [tab, setTab] = useState('mitarbeiter')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [options, setOptions] = useState<Record<string, string[]>>({})

  const loadEntries = useCallback(async () => {
    const { data } = await supabase.from('employee_entries').select('id, employee_id, kind, data').eq('employee_id', id).order('id')
    setEntries((data ?? []) as Entry[])
  }, [id])

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('employees').select('*').eq('id', id).maybeSingle()
    if (error) setError(error.message)
    const e = (data ?? null) as Employee | null
    setEmp(e)
    if (e) {
      setForm(formOf(e))
      setWage({ ...(e.wage_concept ?? {}) })
      setExtra(Object.fromEntries(Object.entries(e.extra ?? {}).map(([k, v]) => [k, v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)])))
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
    if (JSON.stringify(Object.keys(wage).filter((k) => wage[k]).sort()) !== JSON.stringify(Object.keys(emp.wage_concept ?? {}).filter((k) => emp.wage_concept[k]).sort())) return true
    const ex = emp.extra ?? {}
    return Object.keys(extra).some((k) => extra[k] !== (ex[k] == null ? '' : typeof ex[k] === 'object' ? JSON.stringify(ex[k]) : String(ex[k])))
  }, [emp, form, wage, extra])

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
    row.extra = { ...(emp.extra ?? {}), ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, v])) }
    const { error } = await supabase.from('employees').update(row).eq('id', emp.id)
    if (error) setError(error.message)
    await load()
    setBusy(false)
  }

  // Login nach Schema vorname.nachname@joleka.de, Startpasswort wird einmal angezeigt
  async function createAccount() {
    if (!emp) return
    const first = String(form.first_name ?? '').trim()
    const last = String(form.last_name ?? '').trim()
    if (!first || !last) return setError('Bitte zuerst Vor- und Nachname eintragen und speichern.')
    const email = companyEmail(first, last)
    const role = /montage/i.test(String(form.department ?? '')) ? 'monteur' : 'mitarbeiter'
    if (!confirm(`App-Benutzer ${email} (${ROLE_LABEL[role]}) anlegen?`)) return
    setBusy(true)
    setError('')
    try {
      const password = generatePassword()
      const created = (await createUser({ email, full_name: `${first} ${last}`, role, password })) as { id: string }
      const { error } = await supabase.from('employees').update({ user_id: created.id }).eq('id', emp.id)
      if (error) throw error
      if (emp.vacation_days != null) await supabase.from('profiles').update({ vacation_days: emp.vacation_days }).eq('id', created.id)
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
    navigate('/personal')
  }

  if (!loaded) return <p className="muted">Lädt…</p>
  if (!emp) return <p className="error">{error || 'Mitarbeiter nicht gefunden.'}</p>

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))
  const byKind = (k: string) => entries.filter((e) => e.kind === k)
  const age = fullYears(String(form.birth_date || '') || null)
  const seniority = fullYears(String(form.entry_date || '') || null)
  const wc = wageConcept(wage, String(form.entry_date || '') || null)
  const user = emp.user_id ? byId[emp.user_id] : null
  const current = TABS.find((t) => t.key === tab)!

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
        <Link to="/personal">← Personal</Link>
      </div>
      <p className="muted small">
        App-Benutzer: {user ? `${displayName(user)} · ${user.email}` : 'keiner'}
        {me?.role === 'admin' && user && <> · <Link to={`/personal?ansicht=benutzer&bearbeiten=${user.id}`}>Zugang bearbeiten</Link></>}
        {me?.role === 'admin' && !emp.user_id && (
          <> · <button type="button" className="link" disabled={busy} onClick={createAccount}>App-Benutzer anlegen</button></>
        )}
        {emp.ninox_id ? ' · aus Ninox übernommen' : ''}
      </p>
      <nav className="emp-tabs">
        {TABS.map((t) => (
          <button type="button" key={t.key} className={t.key === tab ? 'active' : ''} onClick={() => setTab(t.key)}>{t.title}</button>
        ))}
      </nav>
      {error && <p className="error">{error}</p>}

      <section className="card emp-card">
        {current.sections.map((s, i) => (
          <div key={i} className="emp-section">
            {s.title && <h3 className="emp-heading">{s.title}</h3>}
            {(s.fields?.length || s.computed?.length) ? (
              <div className="emp-grid">
                {s.fields?.map((f) => (
                  <label key={f.key} className={f.wide ? 'wide' : f.type === 'status' ? 'wide' : ''}>
                    {f.label}
                    {f.type === 'choice' && (
                      <datalist id={`opt-${f.key}`}>{(options[f.key] ?? f.options ?? []).map((o) => <option key={o} value={o} />)}</datalist>
                    )}
                    <Input field={f} value={form[f.key] ?? ''} list={f.type === 'choice' ? `opt-${f.key}` : undefined} onChange={(v) => set(f.key, v)} />
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

        {tab === 'mitarbeiter' && Object.keys(extra).length > 0 && (
          <div className="emp-section">
            <h3 className="emp-heading">Weitere Felder aus Ninox</h3>
            <div className="emp-grid">
              {Object.keys(extra).sort((a, b) => a.localeCompare(b, 'de')).map((k) => (
                <label key={k}>
                  {k}
                  <input value={extra[k]} onChange={(e) => setExtra((x) => ({ ...x, [k]: e.target.value }))} />
                </label>
              ))}
            </div>
          </div>
        )}

        {tab === 'lohnkonzept' && (
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
      </section>

      {dirty && (
        <div className="emp-savebar">
          <span>Ungespeicherte Änderungen</span>
          <button type="button" onClick={() => { setForm(formOf(emp)); setWage({ ...(emp.wage_concept ?? {}) }); load() }}>Verwerfen</button>
          <button type="button" className="primary" disabled={busy} onClick={save}>{busy ? 'Speichert…' : 'Speichern'}</button>
        </div>
      )}

      {me?.role === 'admin' && (
        <p><button type="button" className="danger" onClick={removeEmployee}>Mitarbeiter löschen</button></p>
      )}
    </div>
  )
}
