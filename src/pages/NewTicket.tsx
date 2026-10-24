import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { confirmAddresses } from '../lib/addressCheck'
import { AddressFields, CustomerFields, addressesToCheck, addressColumns, customerColumns, emptyAddress, emptyCustomer, type AltAddress, type CustomerData } from '../components/AddressFields'
import { PhotoPicker } from '../components/PhotoPicker'
import { TeamSelect } from '../components/TeamSelect'
import { PositionsEditor, isEmptyPosition, newPositionDraft, type PositionDraft } from '../components/PositionsEditor'
import { uploadPhotos } from '../lib/photos'
import { useTeams } from '../lib/teams'
import { supabase } from '../lib/supabase'
import {
  AREA_LABEL,
  SERVICE_AREAS,
  TICKET_TYPES,
  TYPE_LABEL,
  defaultArea,
  displayName,
  type ServiceArea,
  type TicketType,
} from '../lib/types'
import { useProfiles } from '../lib/useProfiles'

export function NewTicket() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { profile } = useAuth()
  const { leads } = useProfiles()
  const { teams, teamById } = useTeams()
  const canPlan = profile?.role === 'admin' || profile?.role === 'teamleiter'

  const [type, setType] = useState<TicketType>(
    TICKET_TYPES.includes(params.get('art') as TicketType) ? (params.get('art') as TicketType) : 'qm',
  )
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [orderNumber, setOrderNumber] = useState('')
  const [positionNumber, setPositionNumber] = useState('')
  const [area, setArea] = useState<ServiceArea | null>(
    SERVICE_AREAS.includes(params.get('bereich') as ServiceArea) ? (params.get('bereich') as ServiceArea) : null,
  )
  const [positions, setPositions] = useState<PositionDraft[]>(() => [newPositionDraft()])
  const [cust, setCust] = useState<CustomerData>(emptyCustomer)
  const [billingAddr, setBillingAddr] = useState<AltAddress>(emptyAddress)
  const [jobsiteAddr, setJobsiteAddr] = useState<AltAddress>(emptyAddress)
  const [assignedTo, setAssignedTo] = useState('')
  const [teamId, setTeamId] = useState(params.get('team') ?? '')
  const [montageDate, setMontageDate] = useState(params.get('datum') ?? '')
  const [montageTime, setMontageTime] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const einsatz = type !== 'qm'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    if (einsatz && !(await confirmAddresses(addressesToCheck(cust, jobsiteAddr, billingAddr)))) {
      setBusy(false)
      return
    }
    setError('')
    const { data, error } = await supabase
      .from('tickets')
      .insert({
        ticket_type: type,
        service_area: einsatz ? (area ?? defaultArea(type)) : null,
        title: title.trim(),
        description: einsatz ? '' : description.trim(),
        order_number: orderNumber.trim(),
        position_number: einsatz ? '' : positionNumber.trim(),
        ...customerColumns(einsatz ? cust : emptyCustomer),
        site_address: '',
        ...addressColumns(einsatz ? billingAddr : emptyAddress, 'billing'),
        ...addressColumns(einsatz ? jobsiteAddr : emptyAddress, 'jobsite'),
        assigned_to: !einsatz && assignedTo ? assignedTo : null,
        team_id: einsatz && canPlan && teamId ? Number(teamId) : null,
        montage_date: einsatz && canPlan && montageDate ? montageDate : null,
        montage_time: einsatz && canPlan && montageTime ? montageTime : null,
      })
      .select('id')
      .single()
    if (error || !data) {
      setError(error?.message ?? 'Service-Auftrag konnte nicht angelegt werden.')
      setBusy(false)
      return
    }
    const filled = positions.filter((p) => !isEmptyPosition(p))
    const posRows = filled.map((p, i) => ({
      ticket_id: data.id,
      sort: i,
      position_number: String(i + 1),
      description: p.description.trim(),
      article_id: p.article_id ?? null,
    }))
    let saved: { id: number; sort: number }[] = []
    if (einsatz && posRows.length > 0) {
      const { data: rows, error: posErr } = await supabase.from('ticket_positions').insert(posRows).select('id, sort')
      if (posErr) alert(`Auftrag wurde angelegt, aber die Positionen konnten nicht gespeichert werden: ${posErr.message}`)
      saved = rows ?? []
    }
    try {
      await uploadPhotos(data.id, files)
      for (const row of saved) await uploadPhotos(data.id, filled[row.sort].files, row.id)
    } catch (err) {
      alert(`Service-Auftrag wurde angelegt, aber nicht alle Fotos konnten hochgeladen werden: ${(err as Error).message}`)
    }
    navigate(`/ticket/${data.id}`, { replace: true })
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h1>Neu anlegen</h1>
      <div className="segmented" role="radiogroup" aria-label="Art">
        {TICKET_TYPES.map((t) => (
          <button
            type="button"
            key={t}
            role="radio"
            aria-checked={type === t}
            className={type === t ? 'active' : ''}
            onClick={() => setType(t)}
          >
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      <label>
        Kurzbeschreibung *
        <input
          required
          maxLength={150}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={einsatz ? 'z. B. Fenster schließt nicht, Griff tauschen' : 'z. B. Kratzer an Gehäuse Charge 4711'}
        />
      </label>
      <div className="row">
        <label>
          Auftragsnummer
          <input value={orderNumber} maxLength={50} onChange={(e) => setOrderNumber(e.target.value)} />
        </label>
        {!einsatz && (
          <label>
            Positionsnummer
            <input value={positionNumber} maxLength={20} onChange={(e) => setPositionNumber(e.target.value)} />
          </label>
        )}
      </div>
      {einsatz && (
        <div className="field">
          <span>Positionen</span>
          <PositionsEditor positions={positions} onChange={setPositions} withPhotos />
        </div>
      )}
      {einsatz && (
        <>
          <div className="field">
            <span>Bereich</span>
            <div className="segmented two">
              {SERVICE_AREAS.map((a) => (
                <button
                  type="button"
                  key={a}
                  className={(area ?? defaultArea(type)) === a ? 'active' : ''}
                  onClick={() => setArea(a)}
                >
                  {AREA_LABEL[a]}
                </button>
              ))}
            </div>
          </div>
          <CustomerFields value={cust} onChange={setCust} />
          <AddressFields kind="jobsite" value={jobsiteAddr} onChange={setJobsiteAddr} />
          <AddressFields kind="billing" value={billingAddr} onChange={setBillingAddr} />
        </>
      )}
      {!einsatz && (
        <label>
          Beschreibung
          <textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Was ist passiert? Wo? Wann?" />
        </label>
      )}
      <div className="field">
        <span>{einsatz ? 'Fotos zum Auftrag' : 'Fotos'}</span>
        <PhotoPicker files={files} onChange={setFiles} />
      </div>
      {einsatz ? (
        canPlan ? (
          <fieldset className="plan">
            <legend>Einplanen</legend>
            <label>
              Team
              <TeamSelect
                teams={teams}
                value={teamId}
                onChange={(id) => {
                  setTeamId(id)
                  const t = teamById[Number(id)]
                  if (t) setArea(t.area)
                }}
              />
            </label>
            <div className="row">
              <label>
                Montagedatum
                <input type="date" value={montageDate} onChange={(e) => setMontageDate(e.target.value)} />
              </label>
              <label>
                Uhrzeit (optional)
                <input type="time" value={montageTime} onChange={(e) => setMontageTime(e.target.value)} />
              </label>
            </div>
          </fieldset>
        ) : (
          <p className="muted small">Team und Termin werden von QM oder einem Teamleiter eingeplant.</p>
        )
      ) : (
        <label>
          Verantwortlicher Teamleiter
          <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">– später durch QM zuweisen –</option>
            {leads.map((p) => (
              <option key={p.id} value={p.id}>{displayName(p)}</option>
            ))}
          </select>
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" onClick={() => navigate(-1)} disabled={busy}>Abbrechen</button>
        <button className="primary" disabled={busy}>{busy ? 'Speichert…' : `${TYPE_LABEL[type]} anlegen`}</button>
      </div>
    </form>
  )
}
