import { useEffect, useState } from 'react'
import { MAIN_FIELDS, SUBTABLE, WAGE_ITEMS, show, type Field } from '../lib/employee'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL, displayName, type Role } from '../lib/types'
import { useProfiles } from '../lib/useProfiles'

interface LogRow {
  id: number
  at: string
  actor_name: string
  action: string
  area: string | null
  changes: Record<string, { alt: unknown; neu: unknown }>
}

const MAIN = Object.fromEntries(MAIN_FIELDS.map((f) => [f.key, f])) as Record<string, Field>
const WAGE = Object.fromEntries(WAGE_ITEMS.map((w) => [w.key, w.label]))

// Felder des App-Benutzers (Benutzerverwaltung, Chip/PIN)
const USER_LABEL: Record<string, string> = {
  email: 'Login (E-Mail)',
  full_name: 'Name',
  role: 'Rolle',
  active: 'Zugang aktiv',
  supervisor_id: 'Vorgesetzte(r)',
  vacation_days: 'Urlaubsanspruch',
  weekly_hours: 'Wochenstunden',
  overtime_start: 'Stundenkonto ab',
  overtime_opening: 'Übertrag Überstunden',
  montage_capacity: 'Zählt in Montage-Kapazität',
  hr_access: 'Zugriff auf Personalakten',
  badge_uid: 'Chipnummer',
  pin: 'PIN',
}

function actionText(r: LogRow) {
  const area = r.area ? SUBTABLE[r.area]?.title ?? r.area : ''
  switch (r.action) {
    case 'angelegt': return 'Akte angelegt'
    case 'geändert': return 'Akte geändert'
    case 'eintrag_neu': return `${area}: Eintrag hinzugefügt`
    case 'eintrag_geändert': return `${area}: Eintrag geändert`
    case 'eintrag_gelöscht': return `${area}: Eintrag gelöscht`
    case 'benutzer_geändert': return 'App-Benutzer geändert'
    case 'zusammengeführt': return 'Doppelte Akte hineingeführt'
    default: return r.action
  }
}

// Verlauf unter der Personalakte: wer hat wann was geändert (alt → neu)
export function EmployeeHistory({ employeeId, version }: { employeeId: number; version: number }) {
  const { byId } = useProfiles()
  const [rows, setRows] = useState<LogRow[]>([])
  const [all, setAll] = useState(false)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    supabase
      .from('employee_log')
      .select('id, at, actor_name, action, area, changes')
      .eq('employee_id', employeeId)
      .order('at', { ascending: false })
      .order('id', { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        setMissing(!!error)
        setRows((data ?? []) as LogRow[])
      })
  }, [employeeId, version])

  function fieldLabel(r: LogRow, key: string) {
    if (key.startsWith('extra.')) return key.slice(6)
    if (r.area) return SUBTABLE[r.area]?.columns.find((c) => c.key === key)?.label ?? key
    if (r.action === 'benutzer_geändert') return USER_LABEL[key] ?? key
    if (key === 'user_id') return 'App-Benutzer'
    if (key === 'wage_concept') return 'Lohnkonzept'
    if (key === 'work_days') return 'Arbeitstage'
    if (key === 'core_start') return 'Kernarbeitszeit Beginn'
    if (key === 'core_end') return 'Kernarbeitszeit Ende'
    if (key === 'akte') return 'Hineingeführt'
    return MAIN[key]?.label ?? key
  }

  function value(r: LogRow, key: string, v: unknown): string {
    if (v === null || v === undefined || v === '') return '–'
    if (typeof v === 'boolean') return v ? 'Ja' : 'Nein'
    if (r.area) {
      const col = SUBTABLE[r.area]?.columns.find((c) => c.key === key)
      return col ? show(col, v) || '–' : String(v)
    }
    if (r.action === 'benutzer_geändert') {
      if (key === 'role') return ROLE_LABEL[v as Role] ?? String(v)
      if (key === 'supervisor_id') return byId[String(v)] ? displayName(byId[String(v)]) : 'unbekannt'
      return String(v)
    }
    if (key === 'user_id') return byId[String(v)] ? `${displayName(byId[String(v)])} (${byId[String(v)].email})` : 'verknüpft'
    if ((key === 'core_start' || key === 'core_end') && typeof v === 'string') return `${v.slice(0, 5)} Uhr`
    if (key === 'work_days' && Array.isArray(v)) return v.map((d) => ['', 'Mo', 'Di', 'Mi', 'Do', 'Fr'][Number(d)] ?? d).join(', ')
    if (MAIN[key]) return show(MAIN[key], v) || '–'
    return typeof v === 'object' ? JSON.stringify(v) : String(v)
  }

  // Lohnkonzept: nur die geänderten Haken nennen
  function wageLines(c: { alt: unknown; neu: unknown }) {
    const a = (c.alt ?? {}) as Record<string, boolean>
    const n = (c.neu ?? {}) as Record<string, boolean>
    const keys = [...new Set([...Object.keys(a), ...Object.keys(n)])].filter((k) => !!a[k] !== !!n[k])
    return keys.map((k) => `${n[k] ? '+' : '−'} ${WAGE[k] ?? k}`).join(', ') || 'unverändert'
  }

  if (missing) return null
  const shown = all ? rows : rows.slice(0, 30)

  return (
    <section className="card emp-history">
      <h2>Verlauf</h2>
      {rows.length === 0 && <p className="muted">Noch keine Änderungen erfasst.</p>}
      <ul>
        {shown.map((r) => (
          <li key={r.id}>
            <div className="small">
              <b>{new Date(r.at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</b> · {r.actor_name || 'System'} · {actionText(r)}
            </div>
            <ul className="emp-history-changes">
              {Object.entries(r.changes).map(([k, c]) => (
                <li key={k} className="small">
                  <span className="muted">{fieldLabel(r, k)}:</span>{' '}
                  {k === 'wage_concept'
                    ? wageLines(c)
                    : r.action === 'eintrag_neu' || r.action === 'angelegt'
                      ? value(r, k, c.neu)
                      : r.action === 'eintrag_gelöscht' || k === 'akte'
                        ? value(r, k, c.alt)
                        : `${value(r, k, c.alt)} → ${value(r, k, c.neu)}`}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {!all && rows.length > shown.length && (
        <button type="button" className="link" onClick={() => setAll(true)}>Alle {rows.length} Einträge anzeigen</button>
      )}
    </section>
  )
}
