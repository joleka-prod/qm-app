import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'

export function SetPassword() {
  const { profile, setNeedsPassword, reloadProfile } = useAuth()
  const [name, setName] = useState(profile?.full_name ?? '')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) return setError('Das Passwort muss mindestens 8 Zeichen haben.')
    if (password !== repeat) return setError('Die Passwörter stimmen nicht überein.')
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
      setBusy(false)
      return
    }
    if (profile && name.trim() && name.trim() !== profile.full_name) {
      await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', profile.id)
      await reloadProfile()
    }
    setNeedsPassword(false)
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Passwort festlegen</h1>
        <p className="muted">Bitte lege deinen Namen und ein Passwort fest.</p>
        <label>
          Name
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Vorname Nachname" />
        </label>
        <label>
          Neues Passwort
          <input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label>
          Passwort wiederholen
          <input type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>Speichern</button>
      </form>
    </div>
  )
}
