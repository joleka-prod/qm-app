import { FunctionsHttpError } from '@supabase/supabase-js'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { createUser, generatePassword } from '../lib/adminUsers'
import { normalizeBadge } from '../lib/nfc'
import { PERSONNEL_FIELDS } from '../lib/personnel'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL, type Role } from '../lib/types'
import { useProfiles } from '../lib/useProfiles'

// Einmaliger Mitarbeiter-Import aus Ninox (nur Admin): Tabelle wählen, Spalten zuordnen, Vorschau prüfen,
// dann für jeden Mitarbeiter einen Benutzer mit Startpasswort anlegen. Gelesen wird über die Edge Function
// ninox-import, angelegt über admin-users. Ohne E-Mail gibt es einen Zugang nur für das Stempel-Terminal.

type Item = { id: string; name: string }
type NinoxRow = { id: string; fields: Record<string, unknown> }
type Target = 'name' | 'vorname' | 'nachname' | 'email' | 'rolle' | 'wochenstunden' | 'urlaub' | 'eintritt' | 'chip'

const TARGETS: { key: Target; label: string; guess: RegExp }[] = [
  { key: 'vorname', label: 'Vorname', guess: /vorname|first/i },
  { key: 'nachname', label: 'Nachname', guess: /nachname|familienname|last|surname/i },
  { key: 'name', label: 'Name (vollständig)', guess: /^(name|mitarbeiter|vollst.*name|anzeigename)$/i },
  { key: 'email', label: 'E-Mail', guess: /e-?mail|mail/i },
  { key: 'rolle', label: 'Rolle / Funktion', guess: /rolle|funktion|position|t[äa]tigkeit/i },
  { key: 'wochenstunden', label: 'Wochenstunden', guess: /wochenstunden|stunden.*woche|wochenarbeitszeit|arbeitszeit/i },
  { key: 'urlaub', label: 'Urlaubstage pro Jahr', guess: /urlaub/i },
  { key: 'eintritt', label: 'Eintrittsdatum (Stundenkonto ab)', guess: /eintritt|beginn|start/i },
  { key: 'chip', label: 'Chipnummer (Transponder)', guess: /chip|transponder|rfid|badge|schl[üu]ssel/i },
]

// Kennzeichnet Zugänge ohne App-Login (nur Stempel-Terminal)
export const NO_LOGIN_DOMAIN = '@kein-login.invalid'

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

function number(v: string) {
  if (!v) return null
  const n = Number(v.replace(/[^0-9,.-]/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function date(v: string) {
  if (!v) return null
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  if (/^\d{10,13}$/.test(v)) return new Date(Number(v.length === 10 ? v + '000' : v)).toISOString().slice(0, 10)
  return null
}

function guessRole(v: string): Role {
  if (/monteur|monteurin|install/i.test(v)) return 'monteur'
  if (/dispo/i.test(v)) return 'disposition'
  if (/teamleit|meister|leiter|vorarbeiter/i.test(v)) return 'teamleiter'
  if (/admin|gesch[äa]ftsf/i.test(v)) return 'admin'
  return 'mitarbeiter'
}

interface Planned {
  key: string
  row: NinoxRow
  existingId: string | null
  name: string
  email: string
  role: Role
  weekly: number | null
  vacation: number | null
  start: string | null
  chip: string
  status: 'neu' | 'vorhanden' | 'name-vorhanden' | 'fehler'
  problem: string
}

interface Done {
  name: string
  email: string
  password: string
  error: string
  noLogin: boolean
  fileOnly?: boolean
}

export function UserImport() {
  const { profiles, reload } = useProfiles()
  const [teams, setTeams] = useState<Item[]>([])
  const [dbs, setDbs] = useState<Item[]>([])
  const [tables, setTables] = useState<Item[]>([])
  const [team, setTeam] = useState('')
  const [db, setDb] = useState('')
  const [table, setTable] = useState('')
  const [rows, setRows] = useState<NinoxRow[] | null>(null)
  const [map, setMap] = useState<Partial<Record<Target, string>>>({})
  const [roleMap, setRoleMap] = useState<Record<string, Role>>({})
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const [terminalOnly, setTerminalOnly] = useState(true)
  // Personalakte: Ninox-Spalte je Feld; alles Übrige landet unter "Weitere Angaben"
  const [pmap, setPmap] = useState<Record<string, string>>({})
  const [withFile, setWithFile] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [done, setDone] = useState<Done[] | null>(null)

  async function step<T>(label: string, fn: () => Promise<T>) {
    setError('')
    setLoading(label)
    try {
      return await fn()
    } catch (err) {
      setError((err as Error).message)
      return null
    } finally {
      setLoading('')
    }
  }

  // Auswahl Arbeitsbereich → Datenbank → Tabelle; gibt es nur einen Eintrag, wird er gleich gewählt
  useEffect(() => {
    step('Lade Arbeitsbereiche…', () => ninox<Item[]>({ action: 'teams' })).then((t) => {
      if (!t) return
      setTeams(t)
      if (t.length === 1) setTeam(t[0].id)
    })
  }, [])
  useEffect(() => {
    setDbs([])
    setDb('')
    if (!team) return
    step('Lade Datenbanken…', () => ninox<Item[]>({ action: 'databases', team })).then((d) => {
      if (!d) return
      setDbs(d)
      if (d.length === 1) setDb(d[0].id)
    })
  }, [team])
  useEffect(() => {
    setTables([])
    setTable('')
    if (!db) return
    step('Lade Tabellen…', () => ninox<Item[]>({ action: 'tables', team, database: db })).then((t) => {
      if (!t) return
      setTables(t)
      const guess = t.find((x) => /mitarbeiter|personal|employee/i.test(x.name))
      if (guess || t.length === 1) setTable((guess ?? t[0]).id)
    })
  }, [db])
  useEffect(() => {
    setRows(null)
    if (!table) return
    step('Lade Mitarbeiter…', () => ninox<NinoxRow[]>({ action: 'records', team, database: db, table })).then((r) => {
      if (!r) return
      setRows(r)
      const cols = columnsOf(r)
      const m: Partial<Record<Target, string>> = {}
      for (const t of TARGETS) {
        const c = cols.find((c) => t.guess.test(c) && !Object.values(m).includes(c))
        if (c) m[t.key] = c
      }
      // Vor- und Nachname getrennt vorhanden: kein vollständiger Name nötig
      if (m.vorname && m.nachname && m.name && /mitarbeiter/i.test(m.name)) delete m.name
      setMap(m)
      const pm: Record<string, string> = {}
      for (const f of PERSONNEL_FIELDS) {
        const c = cols.find((c) => f.guess.test(c) && !Object.values(pm).includes(c))
        if (c) pm[f.key] = c
      }
      setPmap(pm)
      setSkip(new Set())
    })
  }, [table])

  const columns = useMemo(() => (rows ? columnsOf(rows) : []), [rows])
  const val = (r: NinoxRow, t: Target) => (map[t] ? text(r.fields[map[t]!]) : '')

  const roleValues = useMemo(() => {
    if (!rows || !map.rolle) return []
    return [...new Set(rows.map((r) => val(r, 'rolle')).filter(Boolean))].sort()
  }, [rows, map.rolle])

  useEffect(() => {
    setRoleMap((old) => Object.fromEntries(roleValues.map((v) => [v, old[v] ?? guessRole(v)])))
  }, [roleValues])

  const planned: Planned[] = useMemo(() => {
    if (!rows) return []
    const emails = new Map(profiles.map((p) => [p.email.toLowerCase(), p.id]))
    const names = new Set(profiles.map((p) => p.full_name.trim().toLowerCase()).filter(Boolean))
    const seen = new Set<string>()
    return rows.map((r) => {
      const name = (val(r, 'name') || [val(r, 'vorname'), val(r, 'nachname')].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim()
      const email = val(r, 'email').toLowerCase().replace(/^mailto:/, '')
      const roleText = val(r, 'rolle')
      const p: Planned = {
        key: r.id,
        row: r,
        existingId: email ? emails.get(email) ?? null : null,
        name,
        email,
        role: roleText ? roleMap[roleText] ?? guessRole(roleText) : 'mitarbeiter',
        weekly: number(val(r, 'wochenstunden')),
        vacation: number(val(r, 'urlaub')),
        start: date(val(r, 'eintritt')),
        chip: normalizeBadge(val(r, 'chip')),
        status: 'neu',
        problem: '',
      }
      if (!name) [p.status, p.problem] = ['fehler', 'Name fehlt']
      else if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) [p.status, p.problem] = ['fehler', `E-Mail ungültig: ${email}`]
      else if (email && emails.has(email)) [p.status, p.problem] = ['vorhanden', withFile ? 'Benutzer gibt es schon – nur Personalakte ergänzen' : 'E-Mail gibt es schon']
      else if (email && seen.has(email)) [p.status, p.problem] = ['fehler', 'E-Mail doppelt in Ninox']
      else if (!email && !terminalOnly) [p.status, p.problem] = ['fehler', 'Keine E-Mail']
      else if (names.has(name.toLowerCase())) [p.status, p.problem] = ['name-vorhanden', 'Gleicher Name gibt es schon']
      if (p.weekly !== null && (p.weekly < 0 || p.weekly > 60)) p.weekly = null
      if (p.vacation !== null && (p.vacation < 0 || p.vacation > 366)) p.vacation = null
      if (p.chip && !/^[0-9a-z]{4,40}$/.test(p.chip)) p.chip = ''
      if (email) seen.add(email)
      return p
    })
  }, [rows, map, roleMap, profiles, terminalOnly, withFile])

  // Neue werden angelegt; bei gleichem Namen nur, wenn ausdrücklich angehakt
  const isChosen = (p: Planned) =>
    p.status === 'neu' ? !skip.has(p.key) : p.status === 'name-vorhanden' ? skip.has(p.key) : false
  const chosen = planned.filter(isChosen)
  // Bereits vorhandene Benutzer (gleiche E-Mail): nur Personalakte ergänzen, wenn noch keine da ist
  const fileOnly = withFile ? planned.filter((p) => p.status === 'vorhanden' && p.existingId && !skip.has(p.key)) : []

  function personnelRow(userId: string, r: NinoxRow) {
    const row: Record<string, unknown> = { user_id: userId, source: r.fields }
    // Spalten, die schon Feldern der Akte oder des Benutzers zugeordnet sind, nicht doppelt unter "Weitere Angaben"
    const used = new Set([...Object.values(pmap), ...Object.values(map)])
    for (const f of PERSONNEL_FIELDS) {
      const col = pmap[f.key]
      if (!col) continue
      const v = text(r.fields[col])
      row[f.key] = f.type === 'date' ? date(v) : f.type === 'number' ? number(v) : f.key === 'iban' ? v.replace(/\s+/g, '').toUpperCase() : v
    }
    row.extra = Object.fromEntries(
      Object.entries(r.fields)
        .filter(([k, v]) => !used.has(k) && text(v) !== '')
        .map(([k, v]) => [k, text(v)]),
    )
    return row
  }

  async function saveFile(userId: string, r: NinoxRow, onlyIfMissing: boolean) {
    const { error } = await supabase
      .from('personnel_files')
      .upsert(personnelRow(userId, r), { onConflict: 'user_id', ignoreDuplicates: onlyIfMissing })
    if (error) throw new Error(`Personalakte nicht übernommen: ${error.message.includes('number_idx') ? 'Personalnummer doppelt' : error.message}`)
  }

  function toggle(p: Planned) {
    setSkip((s) => {
      const n = new Set(s)
      if (n.has(p.key)) n.delete(p.key)
      else n.add(p.key)
      return n
    })
  }

  async function runImport() {
    if (!confirm(`${chosen.length} Benutzer anlegen${fileOnly.length ? ` und ${fileOnly.length} Personalakten für vorhandene Benutzer ergänzen` : ''}?`)) return
    setError('')
    setProgress({ done: 0, total: chosen.length + fileOnly.length })
    const out: Done[] = []
    for (const p of chosen) {
      const password = generatePassword()
      const noLogin = !p.email
      const email = p.email || `ohne-login-${crypto.randomUUID().slice(0, 8)}${NO_LOGIN_DOMAIN}`
      try {
        const { id } = (await createUser({ email, full_name: p.name, role: p.role, password })) as { id: string }
        const change: Record<string, unknown> = {}
        if (p.weekly !== null) change.weekly_hours = p.weekly
        if (p.vacation !== null) change.vacation_days = p.vacation
        if (p.start) change.overtime_start = p.start
        if (Object.keys(change).length) {
          const { error } = await supabase.from('profiles').update(change).eq('id', id)
          if (error) throw new Error(`angelegt, aber Stammdaten nicht übernommen: ${error.message}`)
        }
        if (p.chip) {
          const { error } = await supabase.rpc('set_terminal_badge', { p_user: id, p_badge: p.chip })
          if (error) throw new Error(`angelegt, aber Chip nicht übernommen: ${error.message}`)
        }
        if (withFile) await saveFile(id, p.row, false).catch((err) => { throw new Error(`angelegt, aber ${err.message}`) })
        out.push({ name: p.name, email: noLogin ? '' : email, password: noLogin ? '' : password, error: '', noLogin })
      } catch (err) {
        out.push({ name: p.name, email: p.email, password: '', error: (err as Error).message, noLogin })
      }
      setProgress({ done: out.length, total: chosen.length + fileOnly.length })
    }
    for (const p of fileOnly) {
      try {
        await saveFile(p.existingId!, p.row, true)
        out.push({ name: p.name, email: p.email, password: '', error: '', noLogin: false, fileOnly: true })
      } catch (err) {
        out.push({ name: p.name, email: p.email, password: '', error: (err as Error).message, noLogin: false, fileOnly: true })
      }
      setProgress({ done: out.length, total: chosen.length + fileOnly.length })
    }
    setDone(out)
    setProgress(null)
    reload()
  }

  function downloadCsv() {
    if (!done) return
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`
    const lines = ['Name;E-Mail;Startpasswort;Hinweis', ...done.map((d) =>
      [d.name, d.email, d.password, d.error || (d.noLogin ? 'nur Stempel-Terminal' : d.fileOnly ? 'schon vorhanden, Personalakte ergänzt' : '')].map(q).join(';'))]
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'zugangsdaten-import.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (done) {
    const ok = done.filter((d) => !d.error && !d.fileOnly)
    const created = done.filter((d) => !d.fileOnly)
    return (
      <div>
        <div className="page-head">
          <h1>Import abgeschlossen</h1>
          <Link className="button" to="/benutzer">Zur Benutzerverwaltung</Link>
        </div>
        <section className="card">
          <p>
            {ok.length} von {created.length} Benutzern angelegt
            {done.length > created.length && `, ${done.filter((d) => d.fileOnly && !d.error).length} Personalakten für vorhandene Benutzer ergänzt`}. Lade die Zugangsdaten jetzt herunter: Die Startpasswörter werden nur
            hier angezeigt.
          </p>
          <div className="actions">
            <button className="primary" onClick={downloadCsv}>Zugangsdaten herunterladen (CSV)</button>
          </div>
          <div className="cal-scroll">
            <table className="import-table">
              <thead>
                <tr><th>Name</th><th>E-Mail</th><th>Startpasswort</th><th></th></tr>
              </thead>
              <tbody>
                {done.map((d, i) => (
                  <tr key={i} className={d.error ? 'import-error' : ''}>
                    <td>{d.name}</td>
                    <td>{d.noLogin ? <span className="muted">nur Stempel-Terminal</span> : d.email}</td>
                    <td>{d.fileOnly ? <span className="muted">schon vorhanden, Personalakte ergänzt</span> : <code>{d.password}</code>}</td>
                    <td className="small">{d.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div>
      <div className="page-head">
        <h1>Mitarbeiter aus Ninox importieren</h1>
        <Link className="button" to="/benutzer">Zurück</Link>
      </div>

      <section className="card form">
        <h2>1. Tabelle in Ninox</h2>
        <div className="row">
          <label>
            Arbeitsbereich
            <select value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">– wählen –</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label>
            Datenbank
            <select value={db} disabled={!team} onChange={(e) => setDb(e.target.value)}>
              <option value="">– wählen –</option>
              {dbs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label>
            Tabelle
            <select value={table} disabled={!db} onChange={(e) => setTable(e.target.value)}>
              <option value="">– wählen –</option>
              {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </div>
        {loading && <p className="muted">{loading}</p>}
        {error && <p className="error">{error}</p>}
        {rows && <p className="muted small">{rows.length} Datensätze gefunden.</p>}
      </section>

      {rows && rows.length > 0 && (
        <>
          <section className="card form">
            <h2>2. Spalten zuordnen</h2>
            <p className="muted small">Vorbelegt nach den Spaltennamen in Ninox. Name oder Vor- und Nachname sind Pflicht.</p>
            <div className="import-map">
              {TARGETS.map((t) => (
                <label key={t.key}>
                  {t.label}
                  <select value={map[t.key] ?? ''} onChange={(e) => setMap({ ...map, [t.key]: e.target.value || undefined })}>
                    <option value="">– nicht übernehmen –</option>
                    {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {roleValues.length > 0 && (
              <>
                <h3>Rollen zuordnen</h3>
                <div className="import-map">
                  {roleValues.map((v) => (
                    <label key={v}>
                      „{v}“ wird
                      <select value={roleMap[v]} onChange={(e) => setRoleMap({ ...roleMap, [v]: e.target.value as Role })}>
                        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </>
            )}
            <h3>Personalakte</h3>
            <label className="checkbox-row">
              <input type="checkbox" checked={withFile} onChange={(e) => setWithFile(e.target.checked)} />
              Alle Daten in die Personalakte übernehmen (auch für Benutzer, die es schon gibt und noch keine Akte haben)
            </label>
            {withFile && (
              <>
                <p className="muted small">
                  Zugeordnete Spalten kommen in die passenden Felder, alle übrigen Spalten unter „Weitere Angaben“. Der
                  vollständige Ninox-Datensatz wird zusätzlich gespeichert.
                </p>
                <div className="import-map">
                  {PERSONNEL_FIELDS.map((f) => (
                    <label key={f.key}>
                      {f.label}
                      <select value={pmap[f.key] ?? ''} onChange={(e) => setPmap({ ...pmap, [f.key]: e.target.value })}>
                        <option value="">– nicht zuordnen –</option>
                        {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </>
            )}
            <label className="checkbox-row">
              <input type="checkbox" checked={terminalOnly} onChange={(e) => setTerminalOnly(e.target.checked)} />
              Mitarbeiter ohne E-Mail trotzdem anlegen (nur Stempel-Terminal mit Chip/PIN, keine Anmeldung in der App)
            </label>
          </section>

          <section className="card">
            <h2>3. Vorschau</h2>
            <p className="muted small">
              Angehakte Mitarbeiter werden angelegt. Wer schon mit gleicher E-Mail existiert, wird übersprungen. Bei gleichem Namen
              bitte selbst entscheiden. Vorgesetzte trägst du danach unter „Bearbeiten“ ein.
            </p>
            <div className="cal-scroll">
              <table className="import-table">
                <thead>
                  <tr>
                    <th></th><th>Name</th><th>E-Mail</th><th>Rolle</th><th>Std./Woche</th><th>Urlaub</th><th>Ab</th><th>Chip</th><th>Hinweis</th>
                  </tr>
                </thead>
                <tbody>
                  {planned.map((p) => (
                    <tr key={p.key} className={p.status === 'fehler' ? 'import-error' : p.status === 'vorhanden' ? 'muted' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          checked={isChosen(p) || (p.status === 'vorhanden' && withFile && !!p.existingId && !skip.has(p.key))}
                          disabled={p.status === 'fehler' || (p.status === 'vorhanden' && !withFile)}
                          onChange={() => toggle(p)}
                        />
                      </td>
                      <td>{p.name || '–'}</td>
                      <td>{p.email || <span className="muted">keine</span>}</td>
                      <td>{ROLE_LABEL[p.role]}</td>
                      <td>{p.weekly ?? '–'}</td>
                      <td>{p.vacation ?? '–'}</td>
                      <td>{p.start ?? '–'}</td>
                      <td>{p.chip ? '✓' : ''}</td>
                      <td className="small">{p.problem}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="actions">
              {progress ? (
                <span>Lege an… {progress.done} / {progress.total}</span>
              ) : (
                <button className="primary" disabled={chosen.length + fileOnly.length === 0} onClick={runImport}>
                  {chosen.length} Benutzer anlegen{fileOnly.length > 0 && ` + ${fileOnly.length} Akten ergänzen`}
                </button>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function columnsOf(rows: NinoxRow[]) {
  const set = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r.fields)) set.add(k)
  return [...set]
}
