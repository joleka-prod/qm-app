import { useCallback, useEffect, useState } from 'react'
import { rejectReason } from '../lib/rejectReason'
import { supabase } from '../lib/supabase'
import { loadMembers, useTeams, type TeamMember } from '../lib/teams'
import { canSeePersonnel, displayName, formatDate, formatDay, type Profile } from '../lib/types'

export type VacationState = 'beantragt' | 'genehmigt' | 'abgelehnt' | 'storniert'
export type VacationKind = 'urlaub' | 'ueberstunden' | 'krank' | 'sonderurlaub' | 'schulung' | 'schule' | 'unbezahlt' | 'kindkrank'

export const KIND_LABEL: Record<VacationKind, string> = {
  urlaub: 'Urlaubstage', ueberstunden: 'Überstunden', krank: 'Krank', sonderurlaub: 'Sonderurlaub',
  schulung: 'Schulung', schule: 'Schule', unbezahlt: 'Unbezahlter Urlaub', kindkrank: 'Kindkrank',
}

// Arten, die Vorgesetzte und Admin direkt für Mitarbeiter eintragen (sofort genehmigt)
const ENTER_KINDS: VacationKind[] = ['urlaub', 'ueberstunden', 'krank', 'sonderurlaub', 'schulung', 'schule', 'unbezahlt', 'kindkrank']
export const ABSENCE_LABEL: Record<VacationKind, string> = {
  urlaub: 'Urlaub', ueberstunden: 'Zeitausgleich', krank: 'Krank', sonderurlaub: 'Sonderurlaub',
  schulung: 'Schulung', schule: 'Schule', unbezahlt: 'Unbezahlter Urlaub', kindkrank: 'Kindkrank',
}

// Zusatz hinter dem Zeitraum (Urlaub ohne Zusatz)
const KIND_NOTE: Record<VacationKind, string> = {
  urlaub: '', ueberstunden: 'über Überstunden', krank: 'Krankheit', sonderurlaub: 'Sonderurlaub',
  schulung: 'Schulung', schule: 'Schule', unbezahlt: 'Unbezahlter Urlaub', kindkrank: 'Kindkrank',
}

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
  // Genehmiger ohne App-Benutzer (aus TimeTac übernommen)
  decided_by_name?: string
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

// Tage, an denen der Mitarbeiter schon in einem Team eingeplant ist, z. B. "Mo 03.11. (Montage 1)"
function plannedText(list: TeamMember[], teamName: (id: number) => string) {
  return [...list]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((m) => `${formatDay(m.day)} (${teamName(m.team_id)})`)
    .join(', ')
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
  const [form, setForm] = useState<{ start: string; end: string; note: string; kind: VacationKind; half?: boolean } | null>(null)
  const [preview, setPreview] = useState<number | null>(null)
  // Schon eingeplante Tage im gewählten Zeitraum (Hinweis, keine Sperre)
  const [plannedInForm, setPlannedInForm] = useState<TeamMember[]>([])
  // Schon eingeplante Tage der Anträge, die zu genehmigen sind
  const [plannedPending, setPlannedPending] = useState<TeamMember[]>([])
  const { teamById } = useTeams()
  const teamName = (id: number) => teamById[id]?.name ?? 'Team'
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
    const openList = (open.data ?? []) as VacationRequest[]
    setList((mine.data ?? []) as VacationRequest[])
    setPending(openList)
    if (openList.length) {
      const from = openList.reduce((a, r) => (r.start_date < a ? r.start_date : a), openList[0].start_date)
      const to = openList.reduce((a, r) => (r.end_date > a ? r.end_date : a), openList[0].end_date)
      setPlannedPending(await loadMembers(from, to))
    } else setPlannedPending([])
  }, [userId, year, me.id])

  useEffect(() => {
    load()
  }, [load])

  // Arbeitstage des gewählten Zeitraums (ohne Wochenende und Feiertage)
  useEffect(() => {
    setPreview(null)
    if (!form?.start || !form.end || form.end < form.start) return
    supabase.rpc('vacation_workdays', { p_start: form.start, p_end: form.end, p_user: userId }).then(({ data }) => setPreview(data as number))
  }, [form?.start, form?.end, userId])

  useEffect(() => {
    setPlannedInForm([])
    if (!form?.start || !form.end || form.end < form.start) return
    loadMembers(form.start, form.end, userId).then(setPlannedInForm)
  }, [form?.start, form?.end, userId])

  const plannedFor = (r: VacationRequest) =>
    plannedPending.filter((m) => m.installer_id === r.user_id && m.day >= r.start_date && m.day <= r.end_date)

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

  // Abwesenheiten tragen Vorgesetzte, Admin und Personalabteilung für Mitarbeiter ein (sofort genehmigt)
  const canEnter = !own && (canDecide({ user_id: userId } as VacationRequest) || canSeePersonnel(me))
  const entering = !!form && !own

  const allowance = Number(byId[userId]?.vacation_days ?? 0)
  const sum = (s: VacationState) => list.filter((r) => r.state === s && r.kind === 'urlaub').reduce((a, r) => a + r.days, 0)
  const approved = sum('genehmigt')
  const requested = sum('beantragt')
  const rest = allowance - approved - requested

  async function submit() {
    if (!form) return
    const days = form.half && preview === 1 ? 0.5 : preview
    if (plannedInForm.length) {
      const who = own ? 'Du bist' : `${displayName(byId[userId])} ist`
      const msg = `${who} in diesem Zeitraum schon eingeplant: ${plannedText(plannedInForm, teamName)}.\n\nBitte mit der Einsatzplanung abstimmen. Trotzdem ${entering ? 'eintragen' : 'beantragen'}?`
      if (!confirm(msg)) return
    }
    if (form.kind === 'urlaub' && days != null && days > rest && !confirm(`${entering ? 'Der Eintrag' : 'Der Antrag'} (${dayWord(days)}) ist mehr als der Resturlaub (${dayWord(rest)}). Trotzdem ${entering ? 'eintragen' : 'beantragen'}?`)) return
    if (entering) {
      const ok = await run(() =>
        supabase.rpc('enter_absence', { p_user: userId, p_start: form.start, p_end: form.end, p_kind: form.kind, p_note: form.note, p_half: !!form.half }),
      )
      if (ok) setForm(null)
      return
    }
    const ok = await run(() => supabase.rpc('request_vacation', { p_start: form.start, p_end: form.end, p_note: form.note, p_kind: form.kind }))
    if (ok) setForm(null)
  }

  const decide = (r: VacationRequest, approve: boolean) => {
    const note = approve ? '' : rejectReason()
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
                    {KIND_NOTE[r.kind] && <> · {KIND_NOTE[r.kind]}</>}
                  </div>
                  {r.note && <div className="small muted">{r.note}</div>}
                  {plannedFor(r).length > 0 && (
                    <div className="small appointment-warn">⚠ Schon eingeplant: {plannedText(plannedFor(r), teamName)}</div>
                  )}
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
        {!own && canEnter && !form && (
          <button onClick={() => { setError(''); setForm({ start: '', end: '', note: '', kind: 'urlaub' }) }}>
            + Abwesenheit eintragen
          </button>
        )}
        {form && (
          <div className="form vacation-form">
            <div className={entering ? 'segmented' : 'segmented two'} role="radiogroup" aria-label={entering ? 'Art der Abwesenheit' : 'Freizeit über'}>
              {(entering ? ENTER_KINDS : (['urlaub', 'ueberstunden'] as VacationKind[])).map((k) => (
                <button
                  type="button"
                  key={k}
                  role="radio"
                  aria-checked={form.kind === k}
                  className={form.kind === k ? 'active' : ''}
                  onClick={() => setForm({ ...form, kind: k, half: k === 'ueberstunden' ? false : form.half })}
                >
                  {entering ? ABSENCE_LABEL[k] : KIND_LABEL[k]}
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
            {entering && preview === 1 && form.kind !== 'ueberstunden' && (
              <label className="checkbox-row">
                <input type="checkbox" checked={!!form.half} onChange={(e) => setForm({ ...form, half: e.target.checked })} /> Nur halber Tag
              </label>
            )}
            <label>
              Bemerkung
              <input value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="optional" />
            </label>
            {preview != null && (
              <p className="small">
                {entering
                  ? form.kind === 'ueberstunden'
                    ? `${dayWord(preview)} Zeitausgleich (${(preview * Number(byId[userId]?.weekly_hours ?? 40) / 5).toLocaleString('de-DE')} Std. vom Überstundenkonto)`
                    : `${dayWord(form.half && preview === 1 ? 0.5 : preview)} ${ABSENCE_LABEL[form.kind]}`
                  : form.kind === 'urlaub'
                  ? `${dayWord(preview)} Urlaub`
                  : `${dayWord(preview)} frei über Überstunden (${(preview * Number(byId[userId]?.weekly_hours ?? 40) / 5).toLocaleString('de-DE')} Std.)`}{' '}
                (ohne Wochenenden und Feiertage in Rheinland-Pfalz)
              </p>
            )}
            {plannedInForm.length > 0 && (
              <p className="small appointment-warn">
                ⚠ {own ? 'Du bist' : `${displayName(byId[userId])} ist`} in diesem Zeitraum schon eingeplant:{' '}
                {plannedText(plannedInForm, teamName)}. Bitte mit der Einsatzplanung abstimmen.
              </p>
            )}
            {entering && (
              <p className="small muted">
                Wird sofort als genehmigt eingetragen, {displayName(byId[userId])} bekommt dazu eine Info.
                {form.kind === 'urlaub' && ' Zählt gegen den Urlaubsanspruch.'}
              </p>
            )}
            {!entering && !byId[me.id]?.supervisor_id && !isAdmin && (
              <p className="small muted">Dir ist noch kein Vorgesetzter zugeordnet. Der Antrag geht an den Admin.</p>
            )}
            <div className="actions">
              <button disabled={busy} onClick={() => setForm(null)}>Abbrechen</button>
              <button className="primary" disabled={busy || !form.start || !form.end || !preview} onClick={submit}>{entering ? 'Eintragen' : 'Beantragen'}</button>
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
                    {KIND_NOTE[r.kind] && <span className="muted"> · {KIND_NOTE[r.kind]}</span>}{' '}
                    <span className={`badge badge-urlaub-${r.state}`}>{STATE_LABEL[r.state]}</span>
                  </div>
                  {r.note && <div className="small muted">{r.note}</div>}
                  {(r.decided_by || r.decided_by_name) ? (
                    <div className="small muted">
                      {STATE_LABEL[r.state]} von {r.decided_by ? displayName(byId[r.decided_by]) : r.decided_by_name}
                      {r.decided_at && <> am {formatDate(r.decided_at)}</>}
                      {r.decision_note && <> · {r.decision_note}</>}
                    </div>
                  ) : r.decision_note && r.state !== 'beantragt' ? (
                    <div className="small muted">{r.decision_note}</div>
                  ) : null}
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
                  {r.state === 'genehmigt' && (canDecide(r) || (canSeePersonnel(me) && r.user_id !== me.id)) && (
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
