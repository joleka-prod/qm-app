import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth'
import type { Employee } from '../lib/employee'
import { formatBadge, nfcSupported, normalizeBadge, startNfc } from '../lib/nfc'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'

const WEEKDAYS = [
  { day: 1, label: 'Montag' },
  { day: 2, label: 'Dienstag' },
  { day: 3, label: 'Mittwoch' },
  { day: 4, label: 'Donnerstag' },
  { day: 5, label: 'Freitag' },
]

type Creds = { badge_uid: string | null }

type Form = { weekly_hours: string; work_days: number[]; core_start: string; core_end: string; overtime_start: string; overtime_opening: string; badge: string; carryover: string }

const num = (s: string) => Number(s.trim().replace(',', '.'))
// Postgres liefert time als "07:00:00", das Eingabefeld braucht "07:00"
const hhmm = (v: unknown) => (typeof v === 'string' ? v.slice(0, 5) : '')
const YEAR = new Date().getFullYear()
const decimal = (n: number) => String(n).replace('.', ',')

// Reiter "Zeiterfassung" der Personalakte: Wochenstunden, Arbeitstage und Kernarbeitszeit (Personalakte), Stundenkonto und
// Stempel-Terminal (App-Benutzer). Pflegen Admin und Personalabteilung, Stundenkonto nicht das eigene.
export function TimeSettings({ emp, user, onSaved }: { emp: Employee; user: Profile | null; onSaved: () => Promise<void> }) {
  const { profile: me } = useAuth()
  const [creds, setCreds] = useState<Creds | null>(null)
  // Resturlaub aus dem Vorjahr: festgelegter Wert (null = automatisch) und der Wert, der gerade gilt
  const [carry, setCarry] = useState<{ fixed: number | null; current: number } | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reading, setReading] = useState(false)
  const stopReading = useRef<(() => void) | null>(null)
  const ownAccount = !!user && user.id === me?.id && me?.role !== 'admin'

  const reset = useCallback(async () => {
    let c: Creds | null = null
    let cy: { fixed: number | null; current: number } | null = null
    if (user) {
      const [{ data }, fixed, current] = await Promise.all([
        supabase.rpc('terminal_credentials_list'),
        supabase.from('vacation_carryover').select('days').eq('user_id', user.id).eq('year', YEAR).maybeSingle(),
        supabase.rpc('vacation_carryover_days', { p_user: user.id, p_year: YEAR }),
      ])
      c = ((data ?? []) as ({ user_id: string } & Creds)[]).find((r) => r.user_id === user.id) ?? null
      cy = { fixed: fixed.data ? Number(fixed.data.days) : null, current: Number(current.data ?? 0) }
    }
    setCreds(c)
    setCarry(cy)
    setForm({
      weekly_hours: emp.weekly_hours != null ? String(emp.weekly_hours).replace('.', ',') : '',
      work_days: ((emp.work_days as number[] | undefined) ?? [1, 2, 3, 4, 5]).map(Number),
      core_start: hhmm(emp.core_start),
      core_end: hhmm(emp.core_end),
      overtime_start: user?.overtime_start ?? '',
      overtime_opening: String(user?.overtime_opening ?? 0).replace('.', ','),
      badge: formatBadge(c?.badge_uid),
      carryover: cy?.fixed != null ? decimal(cy.fixed) : '',
    })
  }, [emp, user])

  useEffect(() => {
    reset()
  }, [reset])
  useEffect(() => () => stopReading.current?.(), [])

  async function readChip() {
    setError('')
    try {
      setReading(true)
      stopReading.current = await startNfc((serial) => {
        setForm((f) => (f ? { ...f, badge: formatBadge(normalizeBadge(serial)) } : f))
        stopReading.current?.()
        stopReading.current = null
        setReading(false)
      })
    } catch (err) {
      setReading(false)
      setError(`NFC lässt sich nicht starten: ${(err as Error).message}`)
    }
  }

  function toggleDay(day: number, on: boolean) {
    if (!form) return
    const days = on ? [...form.work_days, day].sort() : form.work_days.filter((d) => d !== day)
    setForm({ ...form, work_days: days })
  }

  async function save() {
    if (!form) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const hours = form.weekly_hours.trim() ? num(form.weekly_hours) : null
      if (hours != null && (!Number.isFinite(hours) || hours < 0 || hours > 60)) throw new Error('Bitte bei den Wochenstunden eine Zahl zwischen 0 und 60 eintragen.')
      if (form.work_days.length === 0) throw new Error('Bitte mindestens einen Arbeitstag auswählen.')
      const empChange: Record<string, unknown> = {}
      if (hours !== (emp.weekly_hours != null ? Number(emp.weekly_hours) : null)) empChange.weekly_hours = hours
      const oldDays = ((emp.work_days as number[] | undefined) ?? [1, 2, 3, 4, 5]).map(Number)
      if (JSON.stringify(form.work_days) !== JSON.stringify(oldDays)) empChange.work_days = form.work_days
      if (form.core_start && form.core_end && form.core_end <= form.core_start) throw new Error('Das Ende der Kernarbeitszeit muss nach dem Beginn liegen.')
      if (form.core_start !== hhmm(emp.core_start)) empChange.core_start = form.core_start || null
      if (form.core_end !== hhmm(emp.core_end)) empChange.core_end = form.core_end || null
      if (Object.keys(empChange).length) {
        const { error } = await supabase.from('employees').update(empChange).eq('id', emp.id)
        if (error) throw error
      }
      if (user) {
        const opening = num(form.overtime_opening || '0')
        if (!Number.isFinite(opening) || Math.abs(opening) > 999) throw new Error('Bitte beim Übertrag eine Zahl in Stunden eintragen (z. B. 12,5 oder -3).')
        if (!form.overtime_start) throw new Error('Bitte ein Startdatum für das Stundenkonto eintragen.')
        if (!ownAccount && (form.overtime_start !== user.overtime_start || opening !== Number(user.overtime_opening))) {
          const { error } = await supabase.rpc('set_time_account', { p_user: user.id, p_start: form.overtime_start, p_opening: opening })
          if (error) throw error
        }
        const carryover = form.carryover.trim() ? num(form.carryover) : null
        if (carryover != null && (!Number.isFinite(carryover) || Math.abs(carryover) > 366 || carryover * 2 !== Math.round(carryover * 2)))
          throw new Error('Bitte beim Resturlaub ganze oder halbe Tage eintragen (z. B. 3 oder 2,5) oder das Feld leer lassen.')
        if (!ownAccount && carryover !== (carry?.fixed ?? null)) {
          const { error } = await supabase.rpc('set_vacation_carryover', { p_user: user.id, p_year: YEAR, p_days: carryover })
          if (error) throw error
        }
        const badge = normalizeBadge(form.badge)
        if (badge !== (creds?.badge_uid ?? '')) {
          const { error } = await supabase.rpc('set_terminal_badge', { p_user: user.id, p_badge: badge || null })
          if (error) throw error
        }
      }
      setNotice('Gespeichert.')
      await onSaved()
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  if (!form) return null
  return (
    <div className="emp-section">
      <h3 className="emp-heading">Arbeitszeit laut Vertrag</h3>
      <div className="emp-grid">
        <label>
          Vereinbarte Wochenstunden
          <input inputMode="decimal" value={form.weekly_hours} onChange={(e) => setForm({ ...form, weekly_hours: e.target.value })} />
        </label>
      </div>
      <p className="small" style={{ margin: '0.8rem 0 0.3rem' }}>Vereinbarte Arbeitstage</p>
      <div className="emp-checks">
        {WEEKDAYS.map((w) => (
          <label key={w.day} className="checkbox-row">
            <input type="checkbox" checked={form.work_days.includes(w.day)} onChange={(e) => toggleDay(w.day, e.target.checked)} />
            {w.label}
          </label>
        ))}
      </div>
      <p className="small muted">Das Soll im Überstundenkonto zählt nur an diesen Tagen: Wochenstunden geteilt durch die Anzahl der Arbeitstage.</p>
      <div className="emp-grid" style={{ marginTop: '0.8rem' }}>
        <label>
          Kernarbeitszeit Beginn
          <input type="time" value={form.core_start} onChange={(e) => setForm({ ...form, core_start: e.target.value })} />
        </label>
        <label>
          Kernarbeitszeit Ende
          <input type="time" value={form.core_end} onChange={(e) => setForm({ ...form, core_end: e.target.value })} />
        </label>
      </div>

      <h3 className="emp-heading">Stundenkonto</h3>
      {!user ? (
        <p className="muted small">Kein App-Benutzer verknüpft, daher kein Stundenkonto und kein Stempel-Terminal.</p>
      ) : (
        <>
          <div className="emp-grid">
            <label>
              Stundenkonto ab
              <input type="date" disabled={ownAccount} value={form.overtime_start} onChange={(e) => setForm({ ...form, overtime_start: e.target.value })} />
            </label>
            <label>
              Übertrag Überstunden (Std.)
              <input inputMode="decimal" disabled={ownAccount} value={form.overtime_opening} onChange={(e) => setForm({ ...form, overtime_opening: e.target.value })} />
            </label>
          </div>
          <p className="small muted">
            Ab diesem Datum rechnet die App Soll gegen gestempelte Zeit. Der Übertrag ist der Überstundenstand am Tag davor (z. B. aus TimeTac).
            {ownAccount && ' Dein eigenes Stundenkonto pflegt der Admin.'}
          </p>

          <h3 className="emp-heading">Urlaub</h3>
          <div className="emp-grid">
            <label>
              Resturlaub aus {YEAR - 1} (Tage)
              <input
                inputMode="decimal"
                disabled={ownAccount}
                value={form.carryover}
                placeholder={carry ? `automatisch: ${decimal(carry.current)}` : 'automatisch'}
                onChange={(e) => setForm({ ...form, carryover: e.target.value })}
              />
            </label>
          </div>
          <p className="small muted">
            Leer lassen: die App rechnet den nicht genommenen Urlaub aus {YEAR - 1} aus (Anspruch minus genehmigter Urlaub) und zählt ihn
            zum Anspruch {YEAR} dazu. Ein eingetragener Wert (z. B. aus TimeTac) gilt stattdessen.
            {ownAccount && ' Deinen eigenen Resturlaub pflegt der Admin.'}
          </p>

          <h3 className="emp-heading">Stempel-Terminal</h3>
          <div className="emp-grid">
            <label className="wide">
              Chipnummer (Transponder)
              <div className="input-with-button">
                <input
                  value={form.badge}
                  placeholder="Chip einlesen oder Nummer eintippen"
                  // USB-Leser tippen die Nummer mit Enter: nicht gleich speichern
                  onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                  onChange={(e) => setForm({ ...form, badge: e.target.value })}
                />
                {nfcSupported && (
                  <button type="button" disabled={reading} onClick={readChip}>{reading ? 'Chip vorhalten…' : 'Chip einlesen'}</button>
                )}
              </div>
            </label>
          </div>
        </>
      )}

      {error && <p className="error">{error}</p>}
      {notice && <p className="info">{notice}</p>}
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => { setError(''); setNotice(''); reset() }}>Verwerfen</button>
        <button type="button" className="primary" disabled={busy} onClick={save}>{busy ? 'Speichert…' : 'Zeiterfassung speichern'}</button>
      </div>
    </div>
  )
}
