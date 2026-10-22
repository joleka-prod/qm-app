import { useState } from 'react'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL, type Profile, type Role } from '../lib/types'
import { useProfiles } from '../lib/useProfiles'

export function Users() {
  const { profile: me } = useAuth()
  const { profiles, reload } = useProfiles()
  const [error, setError] = useState('')

  async function patch(p: Profile, change: Partial<Profile>) {
    setError('')
    const { error } = await supabase.from('profiles').update(change).eq('id', p.id)
    if (error) setError(error.message)
    reload()
  }

  return (
    <div>
      <h1>Benutzer</h1>
      <div className="card info-box">
        <strong>Neue Mitarbeiter einladen:</strong> Im Supabase-Dashboard unter{' '}
        <em>Authentication → Users → Invite user</em> die E-Mail-Adresse eingeben. Die Person bekommt eine
        E-Mail, legt ihr Passwort fest und erscheint dann hier als Mitarbeiter. Danach kannst du hier die Rolle ändern.
      </div>
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
                onChange={(e) => patch(p, { role: e.target.value as Role })}
              >
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
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
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
