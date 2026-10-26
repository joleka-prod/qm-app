import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import {
  PERSONNEL_FIELDS,
  PERSONNEL_LABEL,
  PERSONNEL_SECTIONS,
  display,
  masked,
  toDb,
  toInput,
  type PersonnelFile,
} from '../lib/personnel'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL, displayName, formatDate } from '../lib/types'
import { useProfiles } from '../lib/useProfiles'

interface Doc {
  id: number
  title: string
  storage_path: string
  uploaded_by: string | null
  created_at: string
}

interface LogEntry {
  id: number
  actor: string | null
  at: string
  kind: string
  changes: Record<string, unknown>
}

const SECRET = new Set(PERSONNEL_FIELDS.filter((f) => f.type === 'secret').map((f) => f.key))

// Personalakte eines Mitarbeiters: Stammdaten, weitere Felder aus Ninox, Dokumente, Verlauf
export function PersonnelDetail() {
  const { id = '' } = useParams()
  const { profile: me } = useAuth()
  const { byId } = useProfiles()
  const person = byId[id]
  const [file, setFile] = useState<PersonnelFile | null>(null)
  const [docs, setDocs] = useState<Doc[]>([])
  const [log, setLog] = useState<LogEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [edit, setEdit] = useState<{ values: Record<string, string>; extra: [string, string][] } | null>(null)
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [upload, setUpload] = useState<{ title: string; file: File | null }>({ title: '', file: null })

  const load = useCallback(async () => {
    const [f, d, l] = await Promise.all([
      supabase.from('personnel_files').select('*').eq('user_id', id).maybeSingle(),
      supabase.from('personnel_documents').select('*').eq('user_id', id).order('created_at', { ascending: false }),
      supabase.from('personnel_log').select('*').eq('user_id', id).order('at', { ascending: false }).limit(100),
    ])
    if (f.error) setError(f.error.message)
    setFile((f.data ?? null) as PersonnelFile | null)
    setDocs((d.data ?? []) as Doc[])
    setLog((l.data ?? []) as LogEntry[])
    setLoaded(true)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  function startEdit() {
    setError('')
    const values: Record<string, string> = {}
    for (const f of PERSONNEL_FIELDS) values[f.key] = toInput(f, file?.[f.key])
    // neue Akte: Vor- und Nachname aus dem App-Namen vorschlagen
    if (!file && person?.full_name) {
      const parts = person.full_name.trim().split(/\s+/)
      values.last_name = parts.length > 1 ? parts.pop()! : ''
      values.first_name = parts.join(' ')
    }
    setEdit({ values, extra: Object.entries(file?.extra ?? {}).map(([k, v]) => [k, String(v ?? '')]) })
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!edit) return
    setBusy(true)
    setError('')
    const row: Record<string, unknown> = { user_id: id }
    for (const f of PERSONNEL_FIELDS) row[f.key] = toDb(f, edit.values[f.key] ?? '')
    row.extra = Object.fromEntries(edit.extra.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v]))
    const { error } = await supabase.from('personnel_files').upsert(row)
    if (error) setError(error.message.includes('personnel_files_number_idx') ? 'Diese Personalnummer ist schon vergeben.' : error.message)
    else setEdit(null)
    await load()
    setBusy(false)
  }

  async function addDoc(e: FormEvent) {
    e.preventDefault()
    const form = e.currentTarget as HTMLFormElement
    if (!upload.file || !me) return
    setBusy(true)
    setError('')
    const safe = upload.file.name.replace(/[^\w.-]+/g, '_')
    const path = `${id}/${Date.now()}-${safe}`
    const up = await supabase.storage.from('personnel-docs').upload(path, upload.file)
    if (up.error) setError(up.error.message)
    else {
      const { error } = await supabase
        .from('personnel_documents')
        .insert({ user_id: id, title: upload.title.trim() || upload.file.name, storage_path: path, uploaded_by: me.id })
      if (error) setError(error.message)
      setUpload({ title: '', file: null })
      form.reset()
    }
    await load()
    setBusy(false)
  }

  async function openDoc(d: Doc) {
    // herunterladen statt signierter Link, damit nichts im Foto-Zwischenspeicher landet
    const { data, error } = await supabase.storage.from('personnel-docs').download(d.storage_path)
    if (error || !data) return setError(error?.message ?? 'Dokument nicht gefunden')
    const url = URL.createObjectURL(data)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }

  async function removeDoc(d: Doc) {
    if (!confirm(`Dokument „${d.title}“ löschen?`)) return
    await supabase.storage.from('personnel-docs').remove([d.storage_path])
    const { error } = await supabase.from('personnel_documents').delete().eq('id', d.id)
    if (error) setError(error.message)
    load()
  }

  const show = (key: string, v: unknown) => {
    const f = PERSONNEL_FIELDS.find((x) => x.key === key)
    if (!f) return String(v ?? '–')
    if (SECRET.has(key) && !reveal && v) return masked(v)
    return display(f, v)
  }

  if (!person) return <p className="muted">Lädt…</p>

  return (
    <div>
      <div className="page-head">
        <h1>{displayName(person)}</h1>
        <Link className="button" to="/personal">Zur Übersicht</Link>
      </div>
      <p className="muted small">
        {ROLE_LABEL[person.role]} in der App{person.active ? '' : ' · Zugang deaktiviert'}
        {file?.updated_at && <> · zuletzt geändert {formatDate(file.updated_at)}{file.updated_by && <> von {displayName(byId[file.updated_by])}</>}</>}
      </p>
      {error && <p className="error">{error}</p>}

      {edit ? (
        <form className="card form" onSubmit={save}>
          {PERSONNEL_SECTIONS.map((s) => (
            <fieldset key={s.title} className="terminal-creds">
              <legend>{s.title}</legend>
              <div className="import-map">
                {s.fields.map((f) => (
                  <label key={f.key}>
                    {f.label}
                    {f.type === 'textarea' ? (
                      <textarea rows={2} value={edit.values[f.key]} onChange={(e) => setEdit({ ...edit, values: { ...edit.values, [f.key]: e.target.value } })} />
                    ) : (
                      <input
                        type={f.type === 'date' ? 'date' : 'text'}
                        inputMode={f.type === 'number' ? 'decimal' : undefined}
                        autoComplete="off"
                        value={edit.values[f.key]}
                        onChange={(e) => setEdit({ ...edit, values: { ...edit.values, [f.key]: e.target.value } })}
                      />
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <fieldset className="terminal-creds">
            <legend>Weitere Angaben (z. B. aus Ninox)</legend>
            {edit.extra.map(([k, v], i) => (
              <div key={i} className="input-with-button">
                <input placeholder="Feld" value={k} onChange={(e) => setEdit({ ...edit, extra: edit.extra.map((x, j) => (j === i ? [e.target.value, x[1]] : x)) })} />
                <input placeholder="Wert" value={v} onChange={(e) => setEdit({ ...edit, extra: edit.extra.map((x, j) => (j === i ? [x[0], e.target.value] : x)) })} />
                <button type="button" onClick={() => setEdit({ ...edit, extra: edit.extra.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <button type="button" className="link" onClick={() => setEdit({ ...edit, extra: [...edit.extra, ['', '']] })}>+ Feld hinzufügen</button>
          </fieldset>
          <div className="actions">
            <button type="button" disabled={busy} onClick={() => setEdit(null)}>Abbrechen</button>
            <button className="primary" disabled={busy}>{busy ? 'Speichert…' : 'Speichern'}</button>
          </div>
        </form>
      ) : (
        <section className="card">
          <div className="card-head">
            <h2>Personalakte</h2>
            <span className="actions">
              {file && <button className="link" onClick={() => setReveal(!reveal)}>{reveal ? 'Vertrauliches verbergen' : 'Vertrauliches anzeigen'}</button>}
              <button className="primary" onClick={startEdit}>{file ? 'Bearbeiten' : 'Akte anlegen'}</button>
            </span>
          </div>
          {!loaded ? (
            <p className="muted">Lädt…</p>
          ) : !file ? (
            <p className="muted">Für diesen Mitarbeiter gibt es noch keine Personalakte.</p>
          ) : (
            <>
              {PERSONNEL_SECTIONS.map((s) => (
                <div key={s.title} className="personnel-section">
                  <h3>{s.title}</h3>
                  <dl className="personnel-dl">
                    {s.fields.map((f) => (
                      <div key={f.key}>
                        <dt>{f.label}</dt>
                        <dd className={f.type === 'textarea' ? 'pre' : ''}>{show(f.key, file[f.key])}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
              {Object.keys(file.extra ?? {}).length > 0 && (
                <div className="personnel-section">
                  <h3>Weitere Angaben</h3>
                  <dl className="personnel-dl">
                    {Object.entries(file.extra).map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{String(v ?? '') || '–'}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </>
          )}
        </section>
      )}

      <section className="card">
        <h2>Dokumente</h2>
        {docs.length === 0 && <p className="muted small">Noch keine Dokumente.</p>}
        <ul className="terminal-list">
          {docs.map((d) => (
            <li key={d.id}>
              <div>
                <button className="link" onClick={() => openDoc(d)}>{d.title}</button>
                <div className="small muted">{formatDate(d.created_at)}{d.uploaded_by && <> · {displayName(byId[d.uploaded_by])}</>}</div>
              </div>
              <button className="link danger" onClick={() => removeDoc(d)}>Löschen</button>
            </li>
          ))}
        </ul>
        <form className="form" onSubmit={addDoc}>
          <div className="row">
            <label>
              Bezeichnung
              <input value={upload.title} placeholder="z. B. Arbeitsvertrag 2024" onChange={(e) => setUpload({ ...upload, title: e.target.value })} />
            </label>
            <label>
              Datei (PDF, Bild, max. 20 MB)
              <input type="file" onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] ?? null })} />
            </label>
          </div>
          <div className="actions">
            <button className="primary" disabled={busy || !upload.file}>Hochladen</button>
          </div>
        </form>
      </section>

      {log.length > 0 && (
        <section className="card">
          <h2>Verlauf</h2>
          <ul className="history">
            {log.map((l) => (
              <li key={l.id}>
                <span className="muted small">{formatDate(l.at)} · {l.actor ? displayName(byId[l.actor]) : 'System'}</span>
                <span className="small">
                  <strong>{l.kind === 'angelegt' ? 'Akte angelegt' : l.kind === 'dokument' ? 'Dokument' : 'Geändert'}</strong>
                  {': '}
                  {Object.entries(l.changes)
                    .map(([k, c]) => {
                      if (l.kind === 'dokument') return `${String(c)} (${k})`
                      const label = PERSONNEL_LABEL[k] ?? (k === 'extra' ? 'Weitere Angaben' : k)
                      if (SECRET.has(k) || k === 'extra' || l.kind === 'angelegt') return label
                      const { alt, neu } = c as { alt: unknown; neu: unknown }
                      return `${label}: ${alt === null || alt === '' || alt === undefined ? '–' : String(alt)} → ${neu === null || neu === '' ? '–' : String(neu)}`
                    })
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
