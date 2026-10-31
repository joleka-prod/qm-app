import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { useOfflineState } from '../lib/offline'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL, displayName, type Profile } from '../lib/types'

export function ProfilePage() {
  const { profile, reloadProfile, setNeedsPassword } = useAuth()
  const [name, setName] = useState(profile?.full_name ?? '')
  const [msg, setMsg] = useState('')
  const offline = useOfflineState()
  const [supervisor, setSupervisor] = useState<Profile | null>(null)
  const supervisorId = profile?.supervisor_id

  useEffect(() => {
    if (!supervisorId) return setSupervisor(null)
    supabase.from('profiles').select('*').eq('id', supervisorId).maybeSingle().then(({ data }) => setSupervisor(data as Profile | null))
  }, [supervisorId])

  if (!profile) return null

  async function save(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', profile!.id)
    setMsg(error ? error.message : 'Gespeichert.')
    await reloadProfile()
  }

  function logout() {
    if (
      offline.pending > 0 &&
      !confirm(`Es warten noch ${offline.pending} Änderungen auf Übertragung. Sie werden übertragen, sobald du dich wieder anmeldest. Trotzdem abmelden?`)
    )
      return
    supabase.auth.signOut()
  }

  return (
    <>
    <form className="card form" onSubmit={save}>
      <h1>Mein Profil</h1>
      <p className="muted">{profile.email} · {ROLE_LABEL[profile.role]}</p>
      {supervisor && <p className="small">Vorgesetzte(r): {displayName(supervisor)}</p>}
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
    <div className="card">
      <h2>Abmelden</h2>
      <p className="muted">Beendet deine Anmeldung auf diesem Gerät.</p>
      <div className="actions">
        <button type="button" className="danger" onClick={logout}>Abmelden</button>
      </div>
    </div>
    </>
  )
}
