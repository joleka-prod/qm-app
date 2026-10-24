import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { displayName, formatDate, formatDay, type Profile } from '../lib/types'

export type VacationState = 'beantragt' | 'genehmigt' | 'abgelehnt' | 'storniert'
export type VacationKind = 'urlaub' | 'ueberstunden'

export const KIND_LABEL: Record<VacationKind, string> = { urlaub: 'Urlaubstage', ueberstunden: 'Überstunden' }

export interface VacationRequest {
  id: number
  user_id: string
  start_date: string
  end_date: string
  days: number
  note: string
  state: VacationState
  kind: VacationKind
  decided_by: string | null
  decided_at: string | null
  decision_note: string
  created_at: string
}

const STATE_LABEL: Record<VacationState, string> = {
  beantragt: 'Beantragt',
  genehmigt: 'Genehmigt',
  abgelehnt: 'Abgelehnt',
  storniert: 'Storniert',
}

function period(r: VacationRequest) {
  return r.start_date === r.end_date ? formatDay(r.start_date) : `${formatDay(r.start_date)} – ${formatDay(r.end_date)}`
}

const dayWord = (n: number) => `${n.toLocaleString('de-DE')} ${n === 1 ? 'Tag' : 'Tage'}`

interface Props {
  userId: string
  me: Profile
  byId: Record<string, Profile>
  year: number
  onChanged?: () => void
  // 'own': nur Urlaub der Person, 'approvals': nur Anträge zum Genehmigen
  part?: 'all' | 'own' | 'approvals'
}

// Urlaub in der Zeiterfassung: Anträge stellen, Übersicht des Jahres, Genehmigung durch Vorgesetzte
export function VacationCard({ userId, me, byId, year, onChanged, part = 'all' }: Props) {
  const [list, setList] = useState<VacationRequest[]>([])
  const [pending, setPending] = useState<VacationRequest[]>([])
  const [form, setForm] = useState<{ start: string; end: string; note: string; kind: VacationKind } | null>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isAdmin = me.role === 'admin'
  const own = userId === me.id

  const load = useCallback(async () => {
    const [mine, open] = await Promise.all([
      supabase
        .from('vacation_requests')
        .select('*')
        .eq('user_id', userId)
        .gte('start_date', `${year}-01-01`)
        .lte('start_date', `${year}-12-31`)
        .order('start_date'),
      // Offene Anträge anderer, die ich sehen darf (Mitarbeiter bzw. Admin)
      supabase.from('vacation_requests').select('*').eq('state', 'beantragt').neq('user_id', me.id).order('start_date'),
    ])
    setList((mine.data ?? []) as VacationRequest[])
    setPending((open.data ?? []) as VacationRequest[])
  }, [userId, year, me.id])

  useEffect(() => {
    load()
  }, [load])

  // Arbeitstage des gewählten Zeitraums (ohne Wochenende und Feiertage)
  useEffect(() => {
    setPreview(null)
    if (!form?.start || !form.end || form.end < form.start) return
    supabase.rpc('vacation_workdays', { p_start: form.start, p_end: form.end }).then(({ data }) => setPreview(data as number))
  }, [form?.start, form?.end])

  // Entscheiden darf der Admin oder ein Vorgesetzter (auch über mehrere Ebenen), nie über eigene Anträge
  const canDecide = (r: VacationRequest) => {
    if (r.user_id === me.id) return false
    if (isAdmin) return true
    let up = byId[r.user_id]?.supervisor_id
    for (let i = 0; up && i < 10; i++, up = byId[up]?.supervisor_id) if (up === me.id) return true
    return false
  }

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true)
    setError('')
    const { error } = await fn()
    if (error) setError(error.message)
    await load()
    onChanged?.()
    setBusy(false)
    return !error
  }

  const allowance = Number(byId[userId]?.vacation_days ?? 0)
  const sum = (s: VacationState) => list.filter((r) => r.state === s && r.kind !== 'ueberstunden').reduce((a, r) => a + r.days, 0)
  const approved = sum('genehmigt')
  const requested = sum('beantragt')
  const rest = allowance - approved - requested

  async function submit() {
    if (!form) return
    if (form.kind === 'urlaub' && preview != null && preview > rest && !confirm(`Der Antrag (${dayWord(preview)}) ist mehr als der Resturlaub (${dayWord(rest)}). Trotzdem beantragen?`)) return
    const ok = await run(() => supabase.rpc('request_vacation', { p_start: form.start, p_end: form.end, p_note: form.note, p_kind: form.kind }))
    if (ok) setForm(null)
  }

  const decide = (r: VacationRequest, approve: boolean) => {
    const note = approve ? '' : prompt('Grund für die Ablehnung (optional):') ?? null
    if (note === null) return
    run(() => supabase.rpc('decide_vacation', { p_id: r.id, p_approve: approve, p_note: note }))
  }

  const cancel = (r: VacationRequest) => {
    const msg = r.state === 'genehmigt' ? 'Genehmigten Urlaub stornieren?' : 'Antrag zurückziehen?'
    if (confirm(msg)) run(() => supabase.rpc('cancel_vacation', { p_id: r.id }))
  }

  return (
    <>
      {part !== 'own' && pending.some(canDecide) && (
        <section className="card highlight">
          <h2>Urlaubsanträge zu genehmigen</h2>
          <ul className="vacation-list">
            {pending.filter(canDecide).map((r) => (
              <li key={r.id}>
                <div>
                  <strong>{displayName(byId[r.user_id])}</strong>
                  <div className="small">
                    {period(r)} · {dayWord(r.days)}
                    {r.kind === 'ueberstunden' && <> · über Überstunden</>}
                  </div>
                  {r.note && <div className="small muted">{r.note}</div>}
                </div>
                <div className="vacation-actions">
                  <button className="primary" disabled={busy} onClick={() => decide(r, true)}>Genehmigen</button>
                  <button disabled={busy} onClick={() => decide(r, false)}>Ablehnen</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {part !== 'approvals' && (
      <section className="card">
        <h2>Urlaub {year}</h2>
        <div className="vacation-sum">
          <div><span className="muted small">Anspruch</span><strong>{dayWord(allowance)}</strong></div>
          <div><span className="muted small">Genehmigt</span><strong>{dayWord(approved)}</strong></div>
          <div><span className="muted small">Beantragt</span><strong>{dayWord(requested)}</strong></div>
          <div><span className="muted small">Rest</span><strong className={rest < 0 ? 'appointment-warn' : ''}>{dayWord(rest)}</strong></div>
        </div>
        {allowance === 0 && <p className="small muted">Kein Urlaubsanspruch eingetragen. Der Admin kann ihn in der Benutzerverwaltung ändern.</p>}

        {own && !form && (
          <button className="primary" onClick={() => { setError(''); setForm({ start: '', end: '', note: '', kind: 'urlaub' }) }}>
            + Urlaub beantragen
          </button>
        )}
        {form && (
          <div className="form vacation-form">
            <div className="segmented two" role="radiogroup" aria-label="Freizeit über">
              {(['urlaub', 'ueberstunden'] as VacationKind[]).map((k) => (
                <button
                  type="button"
                  key={k}
                  role="radio"
                  aria-checked={form.kind === k}
                  className={form.kind === k ? 'active' : ''}
                  onClick={() => setForm({ ...form, kind: k })}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <div className="row">
              <label>
                Von
                <input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value, end: form.end && form.end >= e.target.value ? form.end : e.target.value })} />
              </label>
              <label>
                Bis
                <input type="date" value={form.end} min={form.start} onChange={(e) => setForm({ ...form, end: e.target.value })} />
              </label>
            </div>
            <label>
              Bemerkung
              <input value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="optional" />
            </label>
            {preview != null && (
              <p className="small">
                {form.kind === 'urlaub'
                  ? `${dayWord(preview)} Urlaub`
                  : `${dayWord(preview)} frei über Überstunden (${(preview * Number(byId[userId]?.weekly_hours ?? 40) / 5).toLocaleString('de-DE')} Std.)`}{' '}
                (ohne Wochenenden und Feiertage in Rheinland-Pfalz)
              </p>
            )}
            {!byId[me.id]?.supervisor_id && !isAdmin && (
              <p className="small muted">Dir ist noch kein Vorgesetzter zugeordnet. Der Antrag geht an den Admin.</p>
            )}
            <div className="actions">
              <button disabled={busy} onClick={() => setForm(null)}>Abbrechen</button>
              <button className="primary" disabled={busy || !form.start || !form.end || !preview} onClick={submit}>Beantragen</button>
            </div>
          </div>
        )}
        {error && <p className="error">{error}</p>}

        {list.length > 0 && (
          <ul className="vacation-list">
            {list.map((r) => (
              <li key={r.id} className={r.state === 'storniert' || r.state === 'abgelehnt' ? 'muted' : ''}>
                <div>
                  <div>
                    {period(r)} · {dayWord(r.days)}
                    {r.kind === 'ueberstunden' && <span className="muted"> · über Überstunden</span>}{' '}
                    <span className={`badge badge-urlaub-${r.state}`}>{STATE_LABEL[r.state]}</span>
                  </div>
                  {r.note && <div className="small muted">{r.note}</div>}
                  {r.decided_by && (
                    <div className="small muted">
                      {STATE_LABEL[r.state]} von {displayName(byId[r.decided_by])} am {formatDate(r.decided_at!)}
                      {r.decision_note && <> · {r.decision_note}</>}
                    </div>
                  )}
                </div>
                <div className="vacation-actions">
                  {r.state === 'beantragt' && canDecide(r) && (
                    <>
                      <button className="primary" disabled={busy} onClick={() => decide(r, true)}>Genehmigen</button>
                      <button disabled={busy} onClick={() => decide(r, false)}>Ablehnen</button>
                    </>
                  )}
                  {r.state === 'beantragt' && r.user_id === me.id && (
                    <button className="link" disabled={busy} onClick={() => cancel(r)}>Zurückziehen</button>
                  )}
                  {r.state === 'genehmigt' && canDecide(r) && (
                    <button className="link danger" disabled={busy} onClick={() => cancel(r)}>Stornieren</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}
    </>
  )
}
