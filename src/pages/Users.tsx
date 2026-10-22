import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { createUser, generatePassword, setPassword } from '../lib/adminUsers'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL, type Profile, type Role } from '../lib/types'
import { useProfiles } from '../lib/useProfiles'

const ROLES = Object.keys(ROLE_LABEL) as Role[]

export function Users() {
  const { profile: me } = useAuth()
  const { profiles, reload } = useProfiles()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('mitarbeiter')
  const [password, setPw] = useState(generatePassword)
  const [busy, setBusy] = useState(false)

  async function patch(p: Profile, change: Partial<Profile>) {
    setError('')
    const { error } = await supabase.from('profiles').update(change).eq('id', p.id)
    if (error) setError(error.message)
    reload()
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
        {profiles.map((p) => (
          <li key={p.id} className={`card user-row ${p.active ? '' : 'inactive'}`}>
            <div>
              <div className="ticket-title">{p.full_name || <span className="muted">(kein Name)</span>}</div>
              <div className="muted small">{p.email}</div>
            </div>
            <div className="user-controls">
              <select
                value={p.role}
                disabled={p.id === me?.id}
                aria-label="Rolle"
                onChange={(e) => patch(p, { role: e.target.value as Role })}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={p.active}
                  disabled={p.id === me?.id}
                  onChange={(e) => patch(p, { active: e.target.checked })}
                />
                aktiv
              </label>
              <button className="link" onClick={() => resetPassword(p)}>Passwort zurücksetzen</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
