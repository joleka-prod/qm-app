import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { rejectReason } from '../lib/rejectReason'
import { supabase } from '../lib/supabase'
import { loadMembers, useTeams, type TeamMember } from '../lib/teams'
import { canSeePersonnel, displayName, formatDate, formatDay, type Profile } from '../lib/types'
import { formatMinutes } from '../lib/clock'
import { blockText, type VacationBlock } from '../lib/vacationBlocks'

export type VacationState = 'beantragt' | 'genehmigt' | 'abgelehnt' | 'storniert'
export type VacationKind = 'urlaub' | 'ueberstunden' | 'krank' | 'sonderurlaub' | 'schulung' | 'schule' | 'unbezahlt' | 'kindkrank'

export const KIND_LABEL: Record<VacationKind, string> = {
  urlaub: 'Urlaubstage', ueberstunden: 'Zeitausgleich', krank: 'Krank', sonderurlaub: 'Sonderurlaub',
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
  // Zeitausgleich stundenweise: Uhrzeit von/bis, Dauer ohne feste Pausen
  start_time?: string | null
  end_time?: string | null
  minutes?: number | null
}

const STATE_LABEL: Record<VacationState, string> = {
  beantragt: 'Beantragt',
  genehmigt: 'Genehmigt',
  abgelehnt: 'Abgelehnt',
  storniert: 'Storniert',
}

const hhmm = (t: string) => t.slice(0, 5)

function period(r: VacationRequest) {
  if (r.start_time && r.end_time) return `${formatDay(r.start_date)}, ${hhmm(r.start_time)} – ${hhmm(r.end_time)} Uhr`
  return r.start_date === r.end_date ? formatDay(r.start_date) : `${formatDay(r.start_date)} – ${formatDay(r.end_date)}`
}

// Dauer: stundenweiser Zeitausgleich in Stunden, sonst in Tagen
const duration = (r: VacationRequest) => (r.minutes ? `${formatMinutes(r.minutes)} h` : dayWord(r.days))

// Tage, an denen der Mitarbeiter schon in einem Team eingeplant ist, z. B. "Mo 03.11. (Montage 1)"
function plannedText(list: TeamMember[], teamName: (id: number) => string) {
  return [...list]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((m) => `${formatDay(m.day)} (${teamName(m.team_id)})`)
    .join(', ')
}

const dayWord = (n: number) => `${n.toLocaleString('de-DE')} ${n === 1 ? 'Tag' : 'Tage'}`

// Minuten zwischen zwei Uhrzeiten "HH:MM" ohne die festen Pausen 09:00–09:15 und 12:00–12:30
function timeMinutes(from: string, to: string) {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const a = m(from)
  const b = m(to)
  if (!(b > a)) return 0
  const overlap = (x: number, y: number) => Math.max(0, Math.min(b, y) - Math.max(a, x))
  return b - a - overlap(9 * 60, 9 * 60 + 15) - overlap(12 * 60, 12 * 60 + 30)
}

interface Props {
  userId: string
  me: Profile
  byId: Record<string, Profile>
  year: number
  onChanged?: () => void
  // 'own': nur Urlaub der Person, 'approvals': nur Anträge zum Genehmigen
  part?: 'all' | 'own' | 'approvals'
  // Neben der Urlaubsübersicht (z. B. Überstunden) und darunter über volle Breite (z. B. Änderungsinfos)
  aside?: ReactNode
  below?: ReactNode
  // Zwischen Übersicht und Anträgen (z. B. Umschalter Kalender/Anträge); showRequests=false blendet die Anträge aus
  between?: ReactNode
  showRequests?: boolean
}

// Urlaub in der Zeiterfassung: Anträge stellen, Übersicht des Jahres, Genehmigung durch Vorgesetzte
export function VacationCard({ userId, me, byId, year, onChanged, part = 'all', aside, below, between, showRequests = true }: Props) {
  const [list, setList] = useState<VacationRequest[]>([])
  // Alle Anträge der Person (alle Jahre, neueste zuerst) für den Reiter Anträge
  const [allList, setAllList] = useState<VacationRequest[]>([])
  const [pending, setPending] = useState<VacationRequest[]>([])
  // Resturlaub aus dem Vorjahr (festgelegt oder berechnet)
  const [carryover, setCarryover] = useState(0)
  const [form, setForm] = useState<{ start: string; end: string; note: string; kind: VacationKind; half?: boolean; from?: string; to?: string } | null>(null)
  const [preview, setPreview] = useState<number | null>(null)
  // Schon eingeplante Tage im gewählten Zeitraum (Hinweis, keine Sperre)
  const [plannedInForm, setPlannedInForm] = useState<TeamMember[]>([])
  // Schon eingeplante Tage der Anträge, die zu genehmigen sind
  const [plannedPending, setPlannedPending] = useState<TeamMember[]>([])
  // Urlaubssperren/Betriebsferien im gewählten Zeitraum bzw. bei den Anträgen zum Genehmigen
  const [blocksInForm, setBlocksInForm] = useState<VacationBlock[]>([])
  const [blocksPending, setBlocksPending] = useState<Record<number, VacationBlock[]>>({})
  const { teamById } = useTeams()
  const teamName = (id: number) => teamById[id]?.name ?? 'Team'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isAdmin = me.role === 'admin'
  const own = userId === me.id

  const load = useCallback(async () => {
    const [mine, open, carry, all] = await Promise.all([
      supabase
        .from('vacation_requests')
        .select('*')
        .eq('user_id', userId)
        .gte('start_date', `${year}-01-01`)
        .lte('start_date', `${year}-12-31`)
        .order('start_date'),
      // Offene Anträge anderer, die ich sehen darf (Mitarbeiter bzw. Admin)
      supabase.from('vacation_requests').select('*').eq('state', 'beantragt').neq('user_id', me.id).order('start_date'),
      supabase.rpc('vacation_carryover_days', { p_user: userId, p_year: year }),
      supabase.from('vacation_requests').select('*').eq('user_id', userId).order('start_date', { ascending: false }).limit(500),
    ])
    setAllList((all.data ?? []) as VacationRequest[])
    setCarryover(Number(carry.data ?? 0))
    const openList = (open.data ?? []) as VacationRequest[]
    setList((mine.data ?? []) as VacationRequest[])
    setPending(openList)
    if (openList.length) {
      const from = openList.reduce((a, r) => (r.start_date < a ? r.start_date : a), openList[0].start_date)
      const to = openList.reduce((a, r) => (r.end_date > a ? r.end_date : a), openList[0].end_date)
      setPlannedPending(await loadMembers(from, to))
      const hits = await Promise.all(
        openList.map((r) => supabase.rpc('vacation_block_hits', { p_user: r.user_id, p_start: r.start_date, p_end: r.end_date })),
      )
      setBlocksPending(Object.fromEntries(openList.map((r, i) => [r.id, ((hits[i].data ?? []) as VacationBlock[]).filter((b) => b.kind === 'sperre')])))
    } else {
      setPlannedPending([])
      setBlocksPending({})
    }
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

  useEffect(() => {
    setPlannedInForm([])
    if (!form?.start || !form.end || form.end < form.start) return
    loadMembers(form.start, form.end, userId).then(setPlannedInForm)
  }, [form?.start, form?.end, userId])

  useEffect(() => {
    setBlocksInForm([])
    if (!form?.start || !form.end || form.end < form.start) return
    supabase
      .rpc('vacation_block_hits', { p_user: userId, p_start: form.start, p_end: form.end })
      .then(({ data }) => setBlocksInForm((data ?? []) as VacationBlock[]))
  }, [form?.start, form?.end, userId])
  // Sperre gilt nur für Urlaub und Zeitausgleich
  const sperreInForm = form && (form.kind === 'urlaub' || form.kind === 'ueberstunden') ? blocksInForm.filter((b) => b.kind === 'sperre') : []
  const ferienInForm = blocksInForm.filter((b) => b.kind === 'betriebsferien')

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
  const total = carryover + allowance
  const rest = total - approved - requested

  // Zeitausgleich mit Uhrzeit (nur für einen einzelnen Tag)
  const timesAllowed = !!form && form.kind === 'ueberstunden' && !!form.start && form.start === form.end
  const hourlyMin = form && timesAllowed && form.from && form.to ? timeMinutes(form.from, form.to) : 0
  const hourly = hourlyMin > 0

  async function submit() {
    if (!form) return
    const days = form.half && preview === 1 ? 0.5 : preview
    if ((form.from || form.to) && !hourly) return setError('Bitte bei der Uhrzeit von und bis eintragen (bis nach von).')
    const times = hourly ? { p_start_time: form.from, p_end_time: form.to } : {}
    if (plannedInForm.length) {
      const who = own ? 'Du bist' : `${displayName(byId[userId])} ist`
      const msg = `${who} in diesem Zeitraum schon eingeplant: ${plannedText(plannedInForm, teamName)}.\n\nBitte mit der Einsatzplanung abstimmen. Trotzdem ${entering ? 'eintragen' : 'beantragen'}?`
      if (!confirm(msg)) return
    }
    if (entering && sperreInForm.length && !confirm(`${sperreInForm.map(blockText).join(', ')}.\n\nTrotzdem als Ausnahme eintragen?`)) return
    if (form.kind === 'urlaub' && days != null && days > rest && !confirm(`${entering ? 'Der Eintrag' : 'Der Antrag'} (${dayWord(days)}) ist mehr als der Resturlaub (${dayWord(rest)}). Trotzdem ${entering ? 'eintragen' : 'beantragen'}?`)) return
    if (entering) {
      const ok = await run(() =>
        supabase.rpc('enter_absence', { p_user: userId, p_start: form.start, p_end: form.end, p_kind: form.kind, p_note: form.note, p_half: !!form.half, ...times }),
      )
      if (ok) setForm(null)
      return
    }
    const ok = await run(() => supabase.rpc('request_vacation', { p_start: form.start, p_end: form.end, p_note: form.note, p_kind: form.kind, ...times }))
    if (ok) setForm(null)
  }

  const decide = (r: VacationRequest, approve: boolean) => {
    const note = approve ? '' : rejectReason()
    if (note === null) return
    run(() => supabase.rpc('decide_vacation', { p_id: r.id, p_approve: approve, p_note: note }))
  }

  // Genehmigen trotz Urlaubssperre nur nach Rückfrage
  const approveBlocked = (r: VacationRequest) => {
    const hits = blocksPending[r.id] ?? []
    if (hits.length && !confirm(`Der Antrag liegt in der ${hits.map(blockText).join(', ')}.\n\nTrotzdem als Ausnahme genehmigen?`)) return
    decide(r, true)
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
                    {period(r)} · {duration(r)}
                    {KIND_NOTE[r.kind] && <> · {KIND_NOTE[r.kind]}</>}
                  </div>
                  {r.note && <div className="small muted">{r.note}</div>}
                  {(blocksPending[r.id] ?? []).length > 0 && (
                    <div className="small appointment-warn">⚠ Liegt in der {blocksPending[r.id].map(blockText).join(', ')}</div>
                  )}
                  {plannedFor(r).length > 0 && (
                    <div className="small appointment-warn">⚠ Schon eingeplant: {plannedText(plannedFor(r), teamName)}</div>
                  )}
                </div>
                <div className="vacation-actions">
                  <button className="primary" disabled={busy} onClick={() => approveBlocked(r)}>Genehmigen</button>
                  <button disabled={busy} onClick={() => decide(r, false)}>Ablehnen</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {part !== 'approvals' && (
      <>
      <div className="time-summary">
      <section className="card">
        <h2>Urlaub {year}</h2>
        <div className="vacation-sum">
          <div><span className="muted small">Resturlaub aus {year - 1}</span><strong>{dayWord(carryover)}</strong></div>
          <div><span className="muted small">Urlaubsanspruch {year}</span><strong>{dayWord(allowance)}</strong></div>
          <div><span className="muted small">Urlaubsanspruch gesamt</span><strong>{dayWord(total)}</strong></div>
          <div><span className="muted small">Genehmigt</span><strong>{dayWord(approved)}</strong></div>
          <div><span className="muted small">Beantragt</span><strong>{dayWord(requested)}</strong></div>
          <div><span className="muted small">Resturlaub</span><strong className={rest < 0 ? 'appointment-warn' : ''}>{dayWord(rest)}</strong></div>
        </div>
        {allowance === 0 && <p className="small muted">Kein Urlaubsanspruch eingetragen. Der Admin kann ihn in der Benutzerverwaltung ändern.</p>}
      </section>
      {aside}
      </div>
      {below}
      {between}

      {showRequests && (
      <section className="card">
        {/* Kopf wie in der Personalübersicht: Überschrift links, Knopf rechts */}
        <div className="card-head">
          {own ? <span /> : <h2>Abwesenheiten</h2>}
          {own && !form && (
            <button className="primary" onClick={() => { setError(''); setForm({ start: '', end: '', note: '', kind: 'urlaub' }) }}>
              + Neuer Antrag
            </button>
          )}
          {!own && canEnter && !form && (
            <button onClick={() => { setError(''); setForm({ start: '', end: '', note: '', kind: 'urlaub' }) }}>
              + Abwesenheit eintragen
            </button>
          )}
        </div>
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
                  onClick={() => setForm({ ...form, kind: k, half: k === 'ueberstunden' ? false : form.half, from: k === 'ueberstunden' ? form.from : '', to: k === 'ueberstunden' ? form.to : '' })}
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
            {form.kind === 'ueberstunden' && (
              timesAllowed ? (
                <div className="row">
                  <label>
                    Uhrzeit von
                    <input type="time" value={form.from ?? ''} onChange={(e) => setForm({ ...form, from: e.target.value })} />
                  </label>
                  <label>
                    Uhrzeit bis
                    <input type="time" value={form.to ?? ''} min={form.from} onChange={(e) => setForm({ ...form, to: e.target.value })} />
                  </label>
                </div>
              ) : (
                <p className="small muted">Für einen Zeitausgleich nur über einige Stunden bei Von und Bis denselben Tag wählen, dann lässt sich die Uhrzeit eintragen.</p>
              )
            )}
            {entering && preview === 1 && form.kind !== 'ueberstunden' && (
              <label className="checkbox-row">
                <input type="checkbox" checked={!!form.half} onChange={(e) => setForm({ ...form, half: e.target.checked })} /> Nur halber Tag
              </label>
            )}
            <label>
              Bemerkung
              <input value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="optional" />
            </label>
            {preview != null && hourly && (
              <p className="small">
                {formatMinutes(hourlyMin)} Std. Zeitausgleich von {form.from} bis {form.to} Uhr (ohne die festen Pausen 09:00–09:15 und 12:00–12:30)
              </p>
            )}
            {preview != null && !hourly && (
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
            {sperreInForm.length > 0 && (
              <p className="small appointment-warn">
                ⚠ {sperreInForm.map(blockText).join(', ')}.{' '}
                {entering ? 'Eintragen nur als Ausnahme.' : 'In diesem Zeitraum kann kein Urlaub beantragt werden. Bitte mit dem Vorgesetzten sprechen.'}
              </p>
            )}
            {ferienInForm.length > 0 && (
              <p className="small muted">
                {ferienInForm.map(blockText).join(', ')}: Dieser Urlaub wird automatisch gebucht.
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
              <button className="primary" disabled={busy || !form.start || !form.end || !preview || (!entering && sperreInForm.length > 0)} onClick={submit}>{entering ? 'Eintragen' : 'Beantragen'}</button>
            </div>
          </div>
        )}
        {error && <p className="error">{error}</p>}

        {allList.length === 0 ? (
          !form && <p className="muted small">{own ? 'Noch keine Anträge.' : 'Noch keine Abwesenheiten.'}</p>
        ) : (
          <div className="cal-scroll">
            <table className="import-table request-table">
              <thead>
                <tr>
                  <th>Zeitraum</th>
                  <th>Art</th>
                  <th className="num">Dauer</th>
                  <th>Status</th>
                  <th>Bemerkung / Entscheidung</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {allList.map((r) => (
                  <tr key={r.id} className={r.state === 'storniert' || r.state === 'abgelehnt' ? 'muted' : ''}>
                    <td>{period(r)}</td>
                    <td>{ABSENCE_LABEL[r.kind] ?? r.kind}</td>
                    <td className="num">{duration(r)}</td>
                    <td><span className={`badge badge-urlaub-${r.state}`}>{STATE_LABEL[r.state]}</span></td>
                    <td className="small">
                      {r.note && <div>{r.note}</div>}
                      {(r.decided_by || r.decided_by_name) ? (
                        <div className="muted">
                          {STATE_LABEL[r.state]} von {r.decided_by ? displayName(byId[r.decided_by]) : r.decided_by_name}
                          {r.decided_at && <> am {formatDate(r.decided_at)}</>}
                          {r.decision_note && <> · {r.decision_note}</>}
                        </div>
                      ) : r.decision_note && r.state !== 'beantragt' ? (
                        <div className="muted">{r.decision_note}</div>
                      ) : null}
                    </td>
                    <td>
                      <div className="vacation-actions">
                        {r.state === 'beantragt' && canDecide(r) && (
                          <>
                            <button className="primary" disabled={busy} onClick={() => approveBlocked(r)}>Genehmigen</button>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}
      </>
      )}
    </>
  )
}
