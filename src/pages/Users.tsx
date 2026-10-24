import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { createUser, deleteUser, generatePassword, setPassword, updateEmail } from '../lib/adminUsers'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL, displayName, type Profile, type Role } from '../lib/types'
import { useProfiles } from '../lib/useProfiles'

const ROLES = Object.keys(ROLE_LABEL) as Role[]

export function Users() {
  const { profile: me } = useAuth()
  const { profiles, byId, reload } = useProfiles()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('mitarbeiter')
  const [password, setPw] = useState(generatePassword)
  const [busy, setBusy] = useState(false)

  const [edit, setEdit] = useState<{ id: string; full_name: string; email: string; role: Role; active: boolean; supervisor_id: string; vacation_days: string } | null>(null)

  function startEdit(p: Profile) {
    setError('')
    setNotice('')
    setEdit({ id: p.id, full_name: p.full_name, email: p.email, role: p.role, active: p.active, supervisor_id: p.supervisor_id ?? '', vacation_days: String(p.vacation_days ?? 0) })
  }

  async function saveEdit(e: FormEvent, p: Profile) {
    e.preventDefault()
    if (!edit) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const change: Partial<Profile> = {}
      if (edit.full_name.trim() !== p.full_name) change.full_name = edit.full_name.trim()
      if (edit.role !== p.role) change.role = edit.role
      if (edit.active !== p.active) change.active = edit.active
      if ((edit.supervisor_id || null) !== p.supervisor_id) change.supervisor_id = edit.supervisor_id || null
      const days = Number(edit.vacation_days.replace(',', '.'))
      if (!Number.isFinite(days) || days < 0 || days > 366) throw new Error('Bitte beim Urlaubsanspruch eine Zahl zwischen 0 und 366 eintragen.')
      if (days !== Number(p.vacation_days)) change.vacation_days = days
      if (Object.keys(change).length > 0) {
        const { error } = await supabase.from('profiles').update(change).eq('id', p.id)
        if (error) throw error
      }
      const email = edit.email.trim().toLowerCase()
      if (email !== p.email) await updateEmail(p.id, email)
      setNotice(
        `${edit.full_name.trim() || email} wurde gespeichert.` +
          (email !== p.email ? ` Neue Login-E-Mail: ${email} (Passwort bleibt gleich).` : ''),
      )
      setEdit(null)
    } catch (err) {
      setError((err as Error).message)
    }
    await reload()
    setBusy(false)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await createUser({ email: email.trim(), full_name: name.trim(), role, password })
      setNotice(`${name.trim()} wurde angelegt. Zugangsdaten zum Weitergeben: E-Mail ${email.trim()} · Passwort ${password}`)
      setName('')
      setEmail('')
      setRole('mitarbeiter')
      setPw(generatePassword())
      setShowForm(false)
      reload()
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  async function resetPassword(p: Profile) {
    const pw = generatePassword()
    if (!confirm(`Neues Passwort für ${p.full_name || p.email} setzen?`)) return
    setError('')
    setNotice('')
    try {
      await setPassword(p.id, pw)
      setNotice(`Neues Passwort für ${p.full_name || p.email}: ${pw}`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function remove(p: Profile) {
    const name = p.full_name || p.email
    if (!confirm(`${name} wirklich löschen? Das kann nicht rückgängig gemacht werden.\n\nHat ${name} schon Aufträge, Fotos oder Zeiten, wird der Zugang nur deaktiviert.`)) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const r = await deleteUser(p.id)
      setNotice(r.deleted ? `${name} wurde gelöscht.` : `${name} hat schon Daten in der App und wurde deshalb nur deaktiviert.`)
    } catch (err) {
      setError((err as Error).message)
    }
    await reload()
    setBusy(false)
  }

  return (
    <div>
      <div className="page-head">
        <h1>Benutzer</h1>
        {!showForm && <button className="primary" onClick={() => setShowForm(true)}>+ Neuer Benutzer</button>}
      </div>

      {showForm && (
        <form className="card form" onSubmit={submit}>
          <h2>Neuen Benutzer anlegen</h2>
          <label>
            Name
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Vorname Nachname" />
          </label>
          <label>
            E-Mail
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Rolle
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          </label>
          <label>
            Startpasswort
            <div className="input-with-button">
              <input required minLength={8} value={password} onChange={(e) => setPw(e.target.value)} />
              <button type="button" onClick={() => setPw(generatePassword())}>Neu</button>
            </div>
          </label>
          <p className="muted small">
            Gib der Person E-Mail und Startpasswort weiter. Sie kann das Passwort danach unter „Mein Profil“ ändern.
          </p>
          <div className="actions">
            <button type="button" onClick={() => setShowForm(false)} disabled={busy}>Abbrechen</button>
            <button className="primary" disabled={busy}>{busy ? 'Legt an…' : 'Anlegen'}</button>
          </div>
        </form>
      )}

      {notice && <p className="info notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <ul className="user-list">
        {profiles.map((p) =>
          edit?.id === p.id ? (
            <li key={p.id} className="card">
              <form className="form" onSubmit={(e) => saveEdit(e, p)}>
                <h2>Benutzer bearbeiten</h2>
                <label>
                  Name
                  <input required value={edit.full_name} maxLength={100} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} />
                </label>
                <label>
                  E-Mail (Login)
                  <input type="email" required value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
                </label>
                <label>
                  Rolle
                  <select value={edit.role} disabled={p.id === me?.id} onChange={(e) => setEdit({ ...edit, role: e.target.value as Role })}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Verantwortliche(r) Vorgesetzte(r)
                  <select value={edit.supervisor_id} onChange={(e) => setEdit({ ...edit, supervisor_id: e.target.value })}>
                    <option value="">– keine(r) –</option>
                    {profiles
                      .filter((o) => o.id !== p.id && (o.active || o.id === p.supervisor_id))
                      .map((o) => (
                        <option key={o.id} value={o.id}>{displayName(o)}</option>
                      ))}
                  </select>
                </label>
                <label>
                  Urlaubsanspruch (Tage pro Jahr)
                  <input
                    inputMode="decimal"
                    value={edit.vacation_days}
                    onChange={(e) => setEdit({ ...edit, vacation_days: e.target.value })}
                  />
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={edit.active}
                    disabled={p.id === me?.id}
                    onChange={(e) => setEdit({ ...edit, active: e.target.checked })}
                  />
                  Zugang aktiv
                </label>
                {p.id === me?.id && <p className="muted small">Die eigene Rolle und den eigenen Zugang kannst du nicht ändern.</p>}
                {edit.email.trim().toLowerCase() !== p.email && (
                  <p className="muted small">Die Person meldet sich danach mit der neuen E-Mail-Adresse an. Das Passwort bleibt gleich.</p>
                )}
                <div className="actions">
                  <button type="button" onClick={() => setEdit(null)} disabled={busy}>Abbrechen</button>
                  <button className="primary" disabled={busy}>{busy ? 'Speichert…' : 'Speichern'}</button>
                </div>
              </form>
            </li>
          ) : (
            <li key={p.id} className={`card user-row ${p.active ? '' : 'inactive'}`}>
              <div>
                <div className="ticket-title">{p.full_name || <span className="muted">(kein Name)</span>}</div>
                <div className="muted small">{p.email}</div>
                <div className="small">
                  {ROLE_LABEL[p.role]}
                  {!p.active && <span className="muted"> · deaktiviert</span>}
                </div>
                <div className="small muted">
                  Vorgesetzte(r): {p.supervisor_id ? displayName(byId[p.supervisor_id]) : '–'} · Urlaub: {Number(p.vacation_days)} Tage/Jahr
                </div>
              </div>
              <div className="user-controls">
                <button onClick={() => startEdit(p)} disabled={busy}>Bearbeiten</button>
                <button className="link" onClick={() => resetPassword(p)}>Passwort zurücksetzen</button>
                {p.id !== me?.id && (
                  <button className="link danger" onClick={() => remove(p)} disabled={busy}>Löschen</button>
                )}
              </div>
            </li>
          ),
        )}
      </ul>
    </div>
  )
}
