import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { TerminalAdmin } from '../components/TerminalAdmin'
import { NO_LOGIN_DOMAIN } from './UserImport'
import { createUser, deleteUser, generatePassword, setPassword, updateEmail } from '../lib/adminUsers'
import { formatBadge, nfcSupported, normalizeBadge, startNfc } from '../lib/nfc'
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

  const [edit, setEdit] = useState<{ id: string; full_name: string; email: string; role: Role; active: boolean; supervisor_id: string; vacation_days: string; weekly_hours: string; overtime_start: string; overtime_opening: string; montage_capacity: boolean; badge: string; pin: string; removePin: boolean } | null>(null)

  // Stempel-Terminal: Chip und PIN je Benutzer (nur Admin, ohne SQL-Update leer)
  const [creds, setCreds] = useState<Record<string, { badge_uid: string | null; has_pin: boolean; locked_until: string | null }>>({})
  const [reading, setReading] = useState(false)
  const stopReading = useRef<(() => void) | null>(null)
  const loadCreds = useCallback(async () => {
    const { data } = await supabase.rpc('terminal_credentials_list')
    const map: typeof creds = {}
    for (const c of (data ?? []) as ({ user_id: string } & (typeof creds)[string])[]) map[c.user_id] = c
    setCreds(map)
  }, [])
  useEffect(() => {
    loadCreds()
  }, [loadCreds])
  useEffect(() => () => stopReading.current?.(), [])

  async function readChip() {
    setError('')
    try {
      setReading(true)
      stopReading.current = await startNfc((serial) => {
        setEdit((e) => (e ? { ...e, badge: formatBadge(normalizeBadge(serial)) } : e))
        stopReading.current?.()
        stopReading.current = null
        setReading(false)
      })
    } catch (err) {
      setReading(false)
      setError(`NFC lässt sich nicht starten: ${(err as Error).message}`)
    }
  }

  function startEdit(p: Profile) {
    setError('')
    setNotice('')
    setEdit({ id: p.id, full_name: p.full_name, email: p.email, role: p.role, active: p.active, supervisor_id: p.supervisor_id ?? '', vacation_days: String(p.vacation_days ?? 0), weekly_hours: String(p.weekly_hours ?? 40).replace('.', ','), overtime_start: p.overtime_start ?? '', overtime_opening: String(p.overtime_opening ?? 0).replace('.', ','), montage_capacity: p.montage_capacity ?? true, badge: formatBadge(creds[p.id]?.badge_uid), pin: '', removePin: false })
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
      const hours = Number(edit.weekly_hours.replace(',', '.'))
      if (!Number.isFinite(hours) || hours < 0 || hours > 60) throw new Error('Bitte bei der Wochenarbeitszeit eine Zahl zwischen 0 und 60 eintragen.')
      if (hours !== Number(p.weekly_hours)) change.weekly_hours = hours
      const opening = Number(edit.overtime_opening.replace(',', '.'))
      if (!Number.isFinite(opening) || Math.abs(opening) > 999) throw new Error('Bitte beim Übertrag eine Zahl in Stunden eintragen (z. B. 12,5 oder -3).')
      if (opening !== Number(p.overtime_opening)) change.overtime_opening = opening
      if (!edit.overtime_start) throw new Error('Bitte ein Startdatum für das Stundenkonto eintragen.')
      if (edit.overtime_start !== p.overtime_start) change.overtime_start = edit.overtime_start
      if (edit.montage_capacity !== (p.montage_capacity ?? true)) change.montage_capacity = edit.montage_capacity
      if (Object.keys(change).length > 0) {
        const { error } = await supabase.from('profiles').update(change).eq('id', p.id)
        if (error) throw error
      }
      const badge = normalizeBadge(edit.badge)
      if (badge !== (creds[p.id]?.badge_uid ?? '')) {
        const { error } = await supabase.rpc('set_terminal_badge', { p_user: p.id, p_badge: badge || null })
        if (error) throw error
      }
      if (edit.pin || edit.removePin) {
        if (edit.pin && !/^[0-9]{4,8}$/.test(edit.pin)) throw new Error('Die PIN muss aus 4 bis 8 Ziffern bestehen.')
        const { error } = await supabase.rpc('set_terminal_pin', { p_user: p.id, p_pin: edit.removePin ? null : edit.pin })
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
    await Promise.all([reload(), loadCreds()])
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
        {!showForm && (
          <div className="actions">
            <Link className="button" to="/benutzer/import">Aus Ninox importieren</Link>
            <button className="primary" onClick={() => setShowForm(true)}>+ Neuer Benutzer</button>
          </div>
        )}
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
                <div className="row">
                  <label>
                    Wochenstunden laut Arbeitsvertrag
                    <input inputMode="decimal" value={edit.weekly_hours} onChange={(e) => setEdit({ ...edit, weekly_hours: e.target.value })} />
                  </label>
                  <label>
                    Stundenkonto ab
                    <input type="date" value={edit.overtime_start} onChange={(e) => setEdit({ ...edit, overtime_start: e.target.value })} />
                  </label>
                  <label>
                    Übertrag Überstunden (Std.)
                    <input inputMode="decimal" value={edit.overtime_opening} onChange={(e) => setEdit({ ...edit, overtime_opening: e.target.value })} />
                  </label>
                </div>
                {edit.role === 'monteur' && (
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={edit.montage_capacity}
                      onChange={(e) => setEdit({ ...edit, montage_capacity: e.target.checked })}
                    />
                    Zählt bei der Kapazitätsplanung Montage mit
                  </label>
                )}
                <fieldset className="terminal-creds">
                  <legend>Stempel-Terminal</legend>
                  <label>
                    Chipnummer (Transponder)
                    <div className="input-with-button">
                      <input
                        value={edit.badge}
                        placeholder="Chip einlesen oder Nummer eintippen"
                        // USB-Leser tippen die Nummer mit Enter: nicht gleich speichern
                        onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                        onChange={(e) => setEdit({ ...edit, badge: e.target.value })}
                      />
                      {nfcSupported && (
                        <button type="button" disabled={reading} onClick={readChip}>{reading ? 'Chip vorhalten…' : 'Chip einlesen'}</button>
                      )}
                    </div>
                  </label>
                  <label>
                    {creds[p.id]?.has_pin ? 'Neue PIN (leer lassen = bleibt)' : 'PIN für Stempeln ohne Chip (4–8 Ziffern, optional)'}
                    <input
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={8}
                      value={edit.pin}
                      disabled={edit.removePin}
                      onChange={(e) => setEdit({ ...edit, pin: e.target.value.replace(/\D/g, '') })}
                    />
                  </label>
                  {creds[p.id]?.has_pin && (
                    <label className="checkbox-row">
                      <input type="checkbox" checked={edit.removePin} onChange={(e) => setEdit({ ...edit, removePin: e.target.checked, pin: '' })} />
                      PIN entfernen
                    </label>
                  )}
                  {creds[p.id]?.locked_until && new Date(creds[p.id].locked_until!) > new Date() && (
                    <p className="small appointment-warn">PIN wegen Fehlversuchen gesperrt bis {new Date(creds[p.id].locked_until!).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr. Eine neue PIN hebt die Sperre auf.</p>
                  )}
                </fieldset>
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
                <div className="muted small">{p.email.endsWith(NO_LOGIN_DOMAIN) ? 'kein App-Login (nur Stempel-Terminal)' : p.email}</div>
                <div className="small">
                  {ROLE_LABEL[p.role]}
                  {!p.active && <span className="muted"> · deaktiviert</span>}
                  {p.role === 'monteur' && p.montage_capacity === false && <span className="muted"> · nicht in der Montage-Kapazität</span>}
                  {creds[p.id]?.badge_uid && <span className="muted"> · Chip {formatBadge(creds[p.id].badge_uid)}</span>}
                  {creds[p.id]?.has_pin && <span className="muted"> · PIN</span>}
                </div>
                <div className="small muted">
                  Vorgesetzte(r): {p.supervisor_id ? displayName(byId[p.supervisor_id]) : '–'} · Urlaub: {Number(p.vacation_days)} Tage/Jahr · {Number(p.weekly_hours).toLocaleString('de-DE')} Std./Woche
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

      <TerminalAdmin />
    </div>
  )
}
