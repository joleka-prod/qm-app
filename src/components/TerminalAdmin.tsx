import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { setTerminalToken, terminalToken } from '../lib/terminal'
import { formatDate } from '../lib/types'

interface TerminalRow {
  id: number
  name: string
  active: boolean
  created_at: string
  last_seen_at: string | null
}

// Benutzerverwaltung: Stempel-Terminals einrichten, sperren, löschen
export function TerminalAdmin() {
  const [list, setList] = useState<TerminalRow[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const isTerminal = !!terminalToken()

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('terminals').select('id, name, active, created_at, last_seen_at').order('id')
    // ohne SQL-Update gibt es die Tabelle noch nicht
    if (error) setError(error.message.includes('terminals') ? 'Bitte zuerst das SQL-Update für das Stempel-Terminal ausführen.' : error.message)
    setList((data ?? []) as TerminalRow[])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function setupThisDevice() {
    const name = prompt('Name des Terminals (z. B. Werkstatt Eingang):', 'Werkstatt')?.trim()
    if (!name) return
    if (!confirm(`Dieses Gerät wird zum Stempel-Terminal „${name}“. Du wirst dafür auf diesem Gerät abgemeldet. Weiter?`)) return
    setBusy(true)
    setError('')
    const { data, error } = await supabase.rpc('create_terminal', { p_name: name })
    if (error) {
      setError(error.message)
      setBusy(false)
      return
    }
    setTerminalToken(data as string)
    await supabase.auth.signOut()
    window.location.href = '/terminal'
  }

  async function update(t: TerminalRow, change: Partial<TerminalRow>) {
    setError('')
    const { error } = await supabase.rpc('update_terminal', { p_id: t.id, p_name: change.name ?? t.name, p_active: change.active ?? t.active })
    if (error) setError(error.message)
    load()
  }

  async function remove(t: TerminalRow) {
    if (!confirm(`Terminal „${t.name}“ löschen? Das Gerät kann danach nicht mehr stempeln. Die bisherigen Stempelzeiten bleiben erhalten.`)) return
    const { error } = await supabase.rpc('delete_terminal', { p_id: t.id })
    if (error) setError(error.message)
    load()
  }

  return (
    <section className="card">
      <h2>Stempel-Terminals</h2>
      <p className="muted small">
        Ein Terminal ist ein Android-Gerät am Eingang, an dem Mitarbeiter mit ihrem Chip oder mit Name + PIN stempeln. Zum
        Einrichten am Gerät selbst als Admin anmelden und hier „Dieses Gerät als Terminal einrichten“ wählen. Chip und PIN
        vergibst du beim jeweiligen Benutzer unter „Bearbeiten“.
      </p>
      {error && <p className="error">{error}</p>}
      {list.length > 0 && (
        <ul className="terminal-list">
          {list.map((t) => (
            <li key={t.id}>
              <div>
                <strong>{t.name}</strong>
                {!t.active && <span className="muted"> · gesperrt</span>}
                <div className="small muted">
                  Zuletzt erreichbar: {t.last_seen_at ? formatDate(t.last_seen_at) : 'noch nie'}
                </div>
              </div>
              <span className="time-actions">
                <button className="link" onClick={() => update(t, { active: !t.active })}>{t.active ? 'Sperren' : 'Freigeben'}</button>
                <button className="link danger" onClick={() => remove(t)}>Löschen</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        {isTerminal && (
          <button
            onClick={() => {
              if (confirm('Den Terminal-Schlüssel von diesem Gerät entfernen?')) {
                setTerminalToken(null)
                window.location.reload()
              }
            }}
          >
            Terminal-Schlüssel hier entfernen
          </button>
        )}
        {isTerminal && <a className="button" href="/terminal">Terminal öffnen</a>}
        <button className="primary" disabled={busy} onClick={setupThisDevice}>Dieses Gerät als Terminal einrichten</button>
      </div>
    </section>
  )
}
