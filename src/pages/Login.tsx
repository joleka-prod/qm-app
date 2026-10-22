import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.')
    setBusy(false)
  }

  async function forgot() {
    if (!email) {
      setError('Bitte zuerst die E-Mail-Adresse eingeben.')
      return
    }
    setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    if (error) setError(error.message)
    else setInfo('Falls die Adresse bekannt ist, wurde ein Link zum Zurücksetzen verschickt.')
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1>QM-Tickets</h1>
        <label>
          E-Mail
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Passwort
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        {info && <p className="info">{info}</p>}
        <button className="primary" disabled={busy}>Anmelden</button>
        <button type="button" className="link" onClick={forgot}>Passwort vergessen?</button>
        <p className="muted small">Zugang erhältst du per Einladung von der QM-Abteilung.</p>
      </form>
    </div>
  )
}
