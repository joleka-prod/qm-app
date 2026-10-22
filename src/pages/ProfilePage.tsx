import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL } from '../lib/types'

export function ProfilePage() {
  const { profile, reloadProfile, setNeedsPassword } = useAuth()
  const [name, setName] = useState(profile?.full_name ?? '')
  const [msg, setMsg] = useState('')

  if (!profile) return null

  async function save(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', profile!.id)
    setMsg(error ? error.message : 'Gespeichert.')
    await reloadProfile()
  }

  return (
    <form className="card form" onSubmit={save}>
      <h1>Mein Profil</h1>
      <p className="muted">{profile.email} · {ROLE_LABEL[profile.role]}</p>
      <label>
        Name
        <input required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {msg && <p className="info">{msg}</p>}
      <div className="actions">
        <button type="button" onClick={() => setNeedsPassword(true)}>Passwort ändern</button>
        <button className="primary">Speichern</button>
      </div>
    </form>
  )
}
