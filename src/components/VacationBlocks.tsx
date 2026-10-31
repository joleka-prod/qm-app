import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { displayName, isoDate, type Profile } from '../lib/types'
import { BLOCK_LABEL, blockPeriod, blockText, type BlockKind, type VacationBlock } from '../lib/vacationBlocks'
import { ABSENCE_LABEL, type VacationKind } from './VacationCard'

interface Conflict {
  request_id: number
  user_id: string
  start_date: string
  end_date: string
  kind: VacationKind
  state: string
}

type Form = { id: number | null; kind: BlockKind; start: string; end: string; reason: string; all: boolean; departments: string[] }

const empty: Form = { id: null, kind: 'sperre', start: '', end: '', reason: '', all: true, departments: [] }

// Zeiterfassung → Reiter "Einstellungen": Urlaubssperren und Betriebsferien für alle oder einzelne Abteilungen.
// Pflegen Admin und Personalabteilung.
export function VacationBlocks({ byId }: { byId: Record<string, Profile> }) {
  const [list, setList] = useState<VacationBlock[]>([])
  const [booked, setBooked] = useState<Record<number, number>>({})
  const [departments, setDepartments] = useState<string[]>([])
  const [form, setForm] = useState<Form | null>(null)
  const [conflicts, setConflicts] = useState<{ block: VacationBlock; rows: Conflict[] } | null>(null)
  const [showPast, setShowPast] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const today = isoDate(new Date())

  const load = useCallback(async () => {
    const [blocks, deps, reqs] = await Promise.all([
      supabase.from('vacation_blocks').select('*').order('start_date', { ascending: false }),
      supabase.rpc('employee_departments'),
      supabase.from('vacation_requests').select('block_id, user_id').not('block_id', 'is', null).eq('state', 'genehmigt'),
    ])
    setList((blocks.data ?? []) as VacationBlock[])
    setDepartments(((deps.data ?? []) as string[]).filter(Boolean))
    // Anzahl Personen mit automatisch gebuchtem Urlaub je Betriebsferien
    const people: Record<number, Set<string>> = {}
    for (const r of (reqs.data ?? []) as { block_id: number; user_id: string }[]) (people[r.block_id] ??= new Set()).add(r.user_id)
    setBooked(Object.fromEntries(Object.entries(people).map(([k, s]) => [k, s.size])))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function showConflicts(block: VacationBlock) {
    if (block.kind !== 'sperre') return setConflicts(null)
    const { data } = await supabase.rpc('vacation_block_conflicts', { p_id: block.id })
    const rows = (data ?? []) as Conflict[]
    setConflicts(rows.length ? { block, rows } : null)
  }

  async function save() {
    if (!form) return
    if (!form.all && form.departments.length === 0) return setError('Bitte mindestens eine Abteilung wählen oder „Alle Mitarbeiter“.')
    if (form.kind === 'betriebsferien') {
      const msg = form.id
        ? 'Betriebsferien speichern? Wurden Zeitraum oder Abteilungen geändert, wird der automatisch gebuchte Urlaub neu angelegt (auch einzeln stornierte Buchungen kommen dann wieder).'
        : 'Betriebsferien speichern? Für alle betroffenen Mitarbeiter wird automatisch genehmigter Urlaub gebucht, der vom Urlaubsanspruch abgeht.'
      if (!confirm(msg)) return
    }
    setBusy(true)
    setError('')
    const { data, error } = await supabase.rpc('save_vacation_block', {
      p_id: form.id,
      p_kind: form.kind,
      p_start: form.start,
      p_end: form.end,
      p_reason: form.reason,
      p_departments: form.all ? [] : form.departments,
    })
    setBusy(false)
    if (error) return setError(error.message)
    const saved: VacationBlock = {
      id: data as number, kind: form.kind, start_date: form.start, end_date: form.end, reason: form.reason.trim(),
      departments: form.all ? [] : form.departments,
    }
    setForm(null)
    await load()
    await showConflicts(saved)
  }

  async function remove(b: VacationBlock) {
    const msg = b.kind === 'betriebsferien'
      ? `Betriebsferien ${blockPeriod(b)} löschen? Der automatisch gebuchte Urlaub wird bei allen Mitarbeitern wieder entfernt.`
      : `Urlaubssperre ${blockPeriod(b)} löschen?`
    if (!confirm(msg)) return
    setBusy(true)
    const { error } = await supabase.rpc('delete_vacation_block', { p_id: b.id })
    setBusy(false)
    if (error) return setError(error.message)
    if (conflicts?.block.id === b.id) setConflicts(null)
    load()
  }

  const edit = (b: VacationBlock) => {
    setError('')
    setConflicts(null)
    setForm({ id: b.id, kind: b.kind, start: b.start_date, end: b.end_date, reason: b.reason, all: b.departments.length === 0, departments: b.departments })
  }

  const toggleDep = (d: string) =>
    form && setForm({ ...form, departments: form.departments.includes(d) ? form.departments.filter((x) => x !== d) : [...form.departments, d] })

  const shown = list.filter((b) => showPast || b.end_date >= today)
  const pastCount = list.length - list.filter((b) => b.end_date >= today).length

  return (
    <div>
      <section className="card">
        <div className="card-head">
          <h2>Urlaubssperren &amp; Betriebsferien</h2>
          {!form && (
            <button className="primary" onClick={() => { setError(''); setConflicts(null); setForm({ ...empty }) }}>
              + Neuer Eintrag
            </button>
          )}
        </div>
        <p className="small muted">
          <strong>Urlaubssperre:</strong> Mitarbeiter können in dem Zeitraum keinen Urlaub und keinen Zeitausgleich beantragen.
          Vorgesetzte, Personalabteilung und Admin können in Ausnahmen trotzdem eintragen oder genehmigen (mit Hinweis).
          Krankmeldungen sind nie gesperrt. <strong>Betriebsferien:</strong> Für alle betroffenen Mitarbeiter wird automatisch
          genehmigter Urlaub gebucht (zählt gegen den Urlaubsanspruch). Tage mit schon eingetragener Abwesenheit werden übersprungen,
          neue Mitarbeiter und Abteilungswechsel werden nachgebucht.
        </p>

        {form && (
          <div className="form vacation-form">
            <div className="segmented two" role="radiogroup" aria-label="Art">
              {(['sperre', 'betriebsferien'] as BlockKind[]).map((k) => (
                <button type="button" key={k} role="radio" aria-checked={form.kind === k} className={form.kind === k ? 'active' : ''} onClick={() => setForm({ ...form, kind: k })}>
                  {BLOCK_LABEL[k]}
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
              Grund / Bezeichnung
              <input value={form.reason} maxLength={200} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={form.kind === 'sperre' ? 'z. B. Inventur, Hauptsaison' : 'z. B. Weihnachtsferien'} />
            </label>
            <div>
              <div className="small muted">Gilt für</div>
              <div className="chip-row">
                <button type="button" className={`chip ${form.all ? 'active' : ''}`} onClick={() => setForm({ ...form, all: true })}>Alle Mitarbeiter</button>
                {departments.map((d) => (
                  <button type="button" key={d} className={`chip ${!form.all && form.departments.includes(d) ? 'active' : ''}`} onClick={() => { setForm({ ...form, all: false, departments: form.all ? [d] : form.departments.includes(d) ? form.departments.filter((x) => x !== d) : [...form.departments, d] }) }}>
                    {d}
                  </button>
                ))}
                {/* Abteilungen, die keiner Personalakte mehr zugeordnet sind */}
                {form.departments.filter((d) => !departments.includes(d)).map((d) => (
                  <button type="button" key={d} className="chip active" onClick={() => toggleDep(d)}>{d}</button>
                ))}
              </div>
              {departments.length === 0 && <p className="small muted">In den Personalakten ist noch keine Abteilung eingetragen.</p>}
            </div>
            {error && <p className="error">{error}</p>}
            <div className="actions">
              <button disabled={busy} onClick={() => setForm(null)}>Abbrechen</button>
              <button className="primary" disabled={busy || !form.start || !form.end} onClick={save}>Speichern</button>
            </div>
          </div>
        )}
        {!form && error && <p className="error">{error}</p>}

        {conflicts && (
          <div className="small appointment-warn">
            <p>
              ⚠ In die {blockText(conflicts.block)} fällt schon eingetragener Urlaub. Er bleibt bestehen, bitte bei Bedarf mit den
              Mitarbeitern klären:
            </p>
            <ul>
              {conflicts.rows.map((c) => (
                <li key={c.request_id}>
                  {displayName(byId[c.user_id])}: {blockPeriod(c)} · {ABSENCE_LABEL[c.kind]} ({c.state === 'beantragt' ? 'beantragt' : 'genehmigt'})
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="cal-scroll">
          <table className="import-table">
            <thead>
              <tr>
                <th>Zeitraum</th>
                <th>Art</th>
                <th>Grund</th>
                <th>Gilt für</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((b) => (
                <tr key={b.id} className={b.end_date < today ? 'muted' : ''}>
                  <td>{blockPeriod(b)}</td>
                  <td>
                    {BLOCK_LABEL[b.kind]}
                    {b.kind === 'betriebsferien' && <div className="small muted">bei {booked[b.id] ?? 0} Mitarbeitern gebucht</div>}
                  </td>
                  <td>{b.reason || <span className="muted">–</span>}</td>
                  <td>{b.departments.length ? b.departments.join(', ') : 'Alle Mitarbeiter'}</td>
                  <td className="num">
                    <button className="link" disabled={busy} onClick={() => edit(b)}>Bearbeiten</button>{' '}
                    <button className="link danger" disabled={busy} onClick={() => remove(b)}>Löschen</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && <p className="muted">Keine Einträge.</p>}
        {pastCount > 0 && (
          <button className="link" onClick={() => setShowPast(!showPast)}>
            {showPast ? 'Vergangene ausblenden' : `Vergangene anzeigen (${pastCount})`}
          </button>
        )}
      </section>
    </div>
  )
}
