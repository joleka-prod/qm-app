import { FunctionsHttpError } from '@supabase/supabase-js'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { createUser, generatePassword, updateEmail } from '../lib/adminUsers'
import {
  MAIN_FIELDS,
  STATUS,
  SUBTABLES,
  WAGE_ITEMS,
  companyEmail,
  norm,
  type Field,
  type SubTable,
} from '../lib/employee'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL, type Profile, type Role } from '../lib/types'
import { useProfiles } from '../lib/useProfiles'

// Einmaliger Import der Ninox-Mitarbeiterdatenbank (nur Admin, Fabian 2026-10-26):
// übernimmt Mitarbeiter mit allen Reitern und Untertabellen in /personal. Nur Mitarbeiter mit Status
// "Aktiv" bekommen einen App-Benutzer (vorname.nachname@joleka.de). Vorhandene Benutzer werden über
// den Namen erkannt; ihre Login-Adresse wird auf das Schema umgestellt. Erneuter Import aktualisiert.

type Item = { id: string; name: string }
type NinoxRow = { id: string; fields: Record<string, unknown> }
type NinoxField = { id: string; name: string; type: string; refTableId: string | null }
type NinoxTable = Item & { fields: NinoxField[] }
type NinoxDb = { tables: NinoxTable[]; records: Record<string, NinoxRow[]> }

async function ninox<T>(body: Record<string, string>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('ninox-import', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null)
      throw new Error(payload?.error ?? 'Ninox-Abfrage fehlgeschlagen')
    }
    throw new Error('Import-Funktion nicht erreichbar. Ist die Funktion „ninox-import“ in Supabase eingerichtet?')
  }
  return data as T
}

// Ninox-Werte als Text (Auswahlfelder kommen teils als Objekt)
function text(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(', ')
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return text(o.caption ?? o.name ?? o.value ?? o.text ?? '')
  }
  return String(v).trim()
}

function toNumber(v: string) {
  if (!v) return null
  const n = Number(v.replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function toDate(v: string) {
  if (!v) return null
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  if (/^\d{10,13}$/.test(v)) return new Date(Number(v.length === 10 ? v + '000' : v)).toISOString().slice(0, 10)
  return null
}

// Ninox-Wert passend zur Feldart der App
function convert(f: Field, raw: unknown): unknown {
  const t = text(raw)
  if (f.type === 'yesno') return raw === true || /^(ja|true|1|yes)$/i.test(t)
  if (t === '') return null
  if (f.type === 'number' || f.type === 'money') return toNumber(t) ?? t
  if (f.type === 'date') return toDate(t) ?? t
  if (f.type === 'datetime') {
    if (/^\d{10,13}$/.test(t)) return new Date(Number(t.length === 10 ? t + '000' : t)).toISOString()
    const d = new Date(t)
    return Number.isNaN(d.getTime()) ? t : d.toISOString()
  }
  if (f.type === 'status') return STATUS.find((s) => s.toLowerCase() === t.toLowerCase()) ?? t
  return t
}

// Ninox-Feld gehört zu App-Feld, wenn der Name (ohne Klammern, Groß/Klein, Sonderzeichen) übereinstimmt
const matches = (ninoxName: string, f: { label: string; ninox?: string[] }) => {
  const n = norm(ninoxName)
  return n !== '' && [f.label, ...(f.ninox ?? [])].some((x) => norm(x) === n)
}

// in Ninox berechnete Felder, die die App selbst rechnet
const COMPUTED = ['Alter', 'Betriebszugehörigkeit', 'Lohn / Gehalt nach neuem LK', 'Berechnung Betriebszugehörigkeit / Erfahrung', 'Stundenlohn Summe', 'Daten löschen'].map(norm)

const refId = (v: unknown) =>
  typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))
    ? String(v)
    : v && typeof v === 'object' && 'id' in (v as object)
      ? String((v as { id: unknown }).id)
      : null

// Feld einer Untertabelle, das auf den Mitarbeiter verweist
function linkFieldOf(t: NinoxTable, rows: NinoxRow[], main: NinoxTable) {
  const byType = t.fields.find((f) => f.refTableId === main.id)?.name
  if (byType) return byType
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.fields)))]
  return keys.find((k) => norm(k) === norm(main.name)) ?? keys.find((k) => norm(main.name).startsWith(norm(k)) && norm(k).length >= 5) ?? null
}

interface Plan {
  ninoxId: string
  row: Record<string, unknown>
  entries: { kind: string; data: Record<string, unknown>; ninox_id: string }[]
  name: string
  status: string
  // Benutzer: neu anlegen, vorhandenen verknüpfen (ggf. Adresse umstellen) oder keiner
  action: 'create' | 'link' | 'none'
  email: string
  existing: Profile | null
  role: Role
}

interface Result {
  name: string
  email: string
  password: string
  note: string
  error: string
}

export function EmployeeImport() {
  const { profiles } = useProfiles()
  const [teams, setTeams] = useState<Item[]>([])
  const [team, setTeam] = useState('')
  const [dbs, setDbs] = useState<Item[]>([])
  const [dbId, setDbId] = useState('')
  const [ndb, setNdb] = useState<NinoxDb | null>(null)
  const [mainId, setMainId] = useState('')
  const [known, setKnown] = useState<Record<string, string | null>>({})
  const [roles, setRoles] = useState<Record<string, Role>>({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [results, setResults] = useState<Result[] | null>(null)

  useEffect(() => {
    setBusy('Lade Arbeitsbereiche…')
    ninox<Item[]>({ action: 'teams' })
      .then((t) => {
        setTeams(t)
        if (t.length === 1) setTeam(t[0].id)
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(''))
    // bereits importierte Mitarbeiter (erneuter Import aktualisiert sie)
    supabase.from('employees').select('ninox_id, user_id').not('ninox_id', 'is', null).then(({ data }) => {
      setKnown(Object.fromEntries((data ?? []).map((r) => [r.ninox_id as string, r.user_id as string | null])))
    })
  }, [])

  useEffect(() => {
    if (!team) return
    setDbs([])
    setDbId('')
    ninox<Item[]>({ action: 'databases', team })
      .then((d) => {
        setDbs(d)
        if (d.length === 1) setDbId(d[0].id)
      })
      .catch((e) => setError(e.message))
  }, [team])

  async function loadDb() {
    setError('')
    setResults(null)
    setBusy('Lade die Ninox-Datenbank…')
    try {
      const d = await ninox<NinoxDb>({ action: 'database', team, database: dbId })
      setNdb(d)
      setMainId((d.tables.find((t) => norm(t.name) === 'mitarbeiter') ?? d.tables[0])?.id ?? '')
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy('')
  }

  const main = ndb?.tables.find((t) => t.id === mainId) ?? null

  // Zuordnung der Ninox-Tabellen zu den Untertabellen der App
  const subs = useMemo(() => {
    if (!ndb || !main) return []
    return ndb.tables
      .filter((t) => t.id !== main.id)
      .map((t) => {
        const rows = ndb.records[t.id] ?? []
        const link = linkFieldOf(t, rows, main)
        const target: SubTable | null = SUBTABLES.find((s) => s.ninox.some((n) => norm(n) === norm(t.name))) ?? null
        return { table: t, rows, link, target }
      })
      .filter((s) => s.link)
  }, [ndb, main])

  const plans = useMemo((): Plan[] => {
    if (!ndb || !main) return []
    const byName = new Map<string, Profile>()
    for (const p of profiles) byName.set(norm(p.full_name), p)
    const used = new Set<string>()
    return (ndb.records[main.id] ?? []).map((r) => {
      const row: Record<string, unknown> = { ninox_id: r.id }
      const wage: Record<string, boolean> = {}
      const extra: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(r.fields)) {
        const f = MAIN_FIELDS.find((x) => matches(k, x))
        if (f) {
          const c = convert(f, v)
          if (c !== null) row[f.key] = c
          continue
        }
        const w = WAGE_ITEMS.find((x) => matches(k, x))
        if (w) {
          if (convert({ key: '', label: '', type: 'yesno' }, v)) wage[w.key] = true
          continue
        }
        if (COMPUTED.includes(norm(k))) continue
        const t = text(v)
        if (t !== '') extra[k] = t
      }
      // Untertabellen ohne eigene Darstellung in der App bleiben als Text in "Weitere Felder"
      const entries: Plan['entries'] = []
      for (const s of subs) {
        for (const sr of s.rows.filter((x) => refId(x.fields[s.link!]) === r.id)) {
          const data: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(sr.fields)) {
            if (k === s.link) continue
            const col = s.target?.columns.find((c) => matches(k, c))
            const c = col ? convert(col, v) : text(v) || null
            if (c !== null && c !== '') data[col?.key ?? k] = c
          }
          if (Object.keys(data).length === 0) continue
          if (s.target) entries.push({ kind: s.target.kind, data, ninox_id: sr.id })
          else extra[s.table.name] = [extra[s.table.name], Object.values(data).join(' · ')].filter(Boolean).join(' | ')
        }
      }
      row.wage_concept = wage
      row.extra = extra
      const first = String(row.first_name ?? '')
      const last = String(row.last_name ?? '')
      const status = String(row.status ?? '')
      if (!row.status) row.status = 'nicht aktiv'
      const existing =
        (known[r.id] ? profiles.find((p) => p.id === known[r.id]) : undefined) ??
        byName.get(norm(`${first} ${last}`)) ??
        byName.get(norm(`${last} ${first}`)) ??
        null
      let email = companyEmail(first, last)
      if (!existing) {
        for (let i = 2; used.has(email) || profiles.some((p) => p.email === email); i++) email = companyEmail(first, last + i)
      }
      used.add(email)
      const active = status === 'Aktiv' && !!first && !!last
      const action: Plan['action'] = existing ? 'link' : active ? 'create' : 'none'
      const role: Role = roles[r.id] ?? (/montage/i.test(String(row.department ?? '')) ? 'monteur' : 'mitarbeiter')
      return { ninoxId: r.id, row, entries, name: [first, last].filter(Boolean).join(' ') || `Ninox #${r.id}`, status: status || '–', action, email, existing, role }
    })
  }, [ndb, main, subs, profiles, known, roles])

  const unknownMain = useMemo(() => {
    if (!ndb || !main) return []
    const keys = new Set<string>()
    for (const r of ndb.records[main.id] ?? []) for (const k of Object.keys(r.fields)) keys.add(k)
    return [...keys].filter((k) => !MAIN_FIELDS.some((f) => matches(k, f)) && !WAGE_ITEMS.some((w) => matches(k, w)) && !COMPUTED.includes(norm(k)))
  }, [ndb, main])

  async function run() {
    const creates = plans.filter((p) => p.action === 'create').length
    const changes = plans.filter((p) => p.action === 'link' && p.status === 'Aktiv' && p.existing && p.existing.email !== p.email).length
    if (!confirm(`${plans.length} Mitarbeiter übernehmen, ${creates} Benutzer neu anlegen, ${changes} Login-Adressen umstellen?`)) return
    setBusy('Importiere…')
    setError('')
    const out: Result[] = []
    for (const p of plans) {
      const res: Result = { name: p.name, email: '', password: '', note: '', error: '' }
      try {
        const { data: emp, error } = await supabase.from('employees').upsert(p.row, { onConflict: 'ninox_id' }).select('id, user_id').single()
        if (error) throw error
        await supabase.from('employee_entries').delete().eq('employee_id', emp.id).not('ninox_id', 'is', null)
        if (p.entries.length) {
          const { error: e2 } = await supabase.from('employee_entries').insert(p.entries.map((e) => ({ ...e, employee_id: emp.id })))
          if (e2) throw e2
        }
        let userId: string | null = emp.user_id
        if (p.action === 'create' && !userId) {
          const password = generatePassword()
          const created = (await createUser({ email: p.email, full_name: p.name, role: p.role, password })) as { id: string }
          userId = created.id
          res.email = p.email
          res.password = password
          res.note = 'Benutzer angelegt'
        } else if (p.action === 'link' && p.existing) {
          userId = p.existing.id
          res.email = p.existing.email
          if (p.status === 'Aktiv' && p.existing.email !== p.email) {
            await updateEmail(p.existing.id, p.email)
            res.email = p.email
            res.note = `Login-Adresse geändert (vorher ${p.existing.email})`
          } else res.note = 'mit vorhandenem Benutzer verknüpft'
        } else res.note = 'ohne Benutzer'
        if (userId && userId !== emp.user_id) {
          const { error: e3 } = await supabase.from('employees').update({ user_id: userId }).eq('id', emp.id)
          if (e3) throw e3
        }
        if (userId && typeof p.row.vacation_days === 'number') {
          await supabase.from('profiles').update({ vacation_days: p.row.vacation_days }).eq('id', userId)
        }
      } catch (e) {
        res.error = (e as Error).message
      }
      out.push(res)
    }
    setResults(out)
    setBusy('')
  }

  function downloadCsv() {
    if (!results) return
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`
    const lines = ['Name;E-Mail;Startpasswort;Hinweis', ...results.filter((r) => r.email).map((r) => [r.name, r.email, r.password, r.error || r.note].map(q).join(';'))]
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'zugangsdaten-import.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const count = (a: Plan['action']) => plans.filter((p) => p.action === a).length

  return (
    <div>
      <div className="page-head">
        <h1>Personal aus Ninox importieren</h1>
        <Link to="/personal">← Personal</Link>
      </div>
      {error && <p className="error">{error}</p>}
      {busy && <p className="muted">{busy}</p>}

      <section className="card">
        <div className="import-map">
          <label>
            Arbeitsbereich
            <select value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">– wählen –</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label>
            Datenbank
            <select value={dbId} onChange={(e) => setDbId(e.target.value)}>
              <option value="">– wählen –</option>
              {dbs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          {ndb && (
            <label>
              Mitarbeiter-Tabelle
              <select value={mainId} onChange={(e) => setMainId(e.target.value)}>
                {ndb.tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <p><button className="primary" disabled={!dbId || !!busy} onClick={loadDb}>Ninox-Daten laden</button></p>
      </section>

      {ndb && main && !results && (
        <>
          <section className="card">
            <h2>Zuordnung</h2>
            <p className="small">
              Untertabellen: {subs.map((s) => `${s.table.name} (${s.rows.length})${s.target ? '' : ' → Weitere Felder'}`).join(', ') || 'keine gefunden'}
            </p>
            {unknownMain.length > 0 && (
              <p className="small muted">Ohne eigenes Feld, kommen unter „Weitere Felder aus Ninox“: {unknownMain.join(', ')}</p>
            )}
          </section>
          <section className="card">
            <div className="card-head">
              <h2>Vorschau: {plans.length} Mitarbeiter</h2>
              <button className="primary" disabled={!!busy || plans.length === 0} onClick={run}>Import starten</button>
            </div>
            <p className="small muted">
              {count('create')} neue Benutzer, {count('link')} vorhandene Benutzer, {count('none')} ohne Benutzer (nicht aktiv, langzeitkrank oder ehemalig).
            </p>
            <div className="cal-scroll">
              <table className="import-table">
                <thead>
                  <tr><th>Name</th><th>Status</th><th>App-Benutzer</th><th>Rolle</th><th>Einträge</th></tr>
                </thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.ninoxId}>
                      <td>{p.name}</td>
                      <td>{p.status}</td>
                      <td>
                        {p.action === 'create' && <>neu: {p.email}</>}
                        {p.action === 'link' && p.existing && (
                          <>vorhanden: {p.existing.email}{p.status === 'Aktiv' && p.existing.email !== p.email && <> → <b>{p.email}</b></>}</>
                        )}
                        {p.action === 'none' && <span className="muted">kein Benutzer</span>}
                      </td>
                      <td>
                        {p.action === 'create' ? (
                          <select value={p.role} onChange={(e) => setRoles((r) => ({ ...r, [p.ninoxId]: e.target.value as Role }))}>
                            {(Object.keys(ROLE_LABEL) as Role[]).filter((r) => r !== 'admin').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                          </select>
                        ) : p.existing ? ROLE_LABEL[p.existing.role] : '–'}
                      </td>
                      <td>{p.entries.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {results && (
        <section className="card">
          <div className="card-head">
            <h2>Ergebnis</h2>
            <button onClick={downloadCsv}>Zugangsdaten als CSV</button>
          </div>
          <p className="small">Die Startpasswörter werden nur hier angezeigt. Bitte die CSV-Datei sichern und die Zugangsdaten weitergeben.</p>
          <div className="cal-scroll">
            <table className="import-table">
              <thead>
                <tr><th>Name</th><th>Login</th><th>Startpasswort</th><th>Hinweis</th></tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className={r.error ? 'import-error' : ''}>
                    <td>{r.name}</td>
                    <td>{r.email || '–'}</td>
                    <td>{r.password ? <code>{r.password}</code> : ''}</td>
                    <td>{r.error || r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p><Link to="/personal">Zum Personal</Link></p>
        </section>
      )}
    </div>
  )
}
