import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { confirmAddresses } from '../lib/addressCheck'
import { CalcTimeFields, calcTimeColumns } from '../components/CalcTimeFields'
import { AddressFields, CustomerFields, customerFromMaster, addressesToCheck, addressColumns, customerColumns, emptyAddress, emptyCustomer, type AltAddress, type CustomerData } from '../components/AddressFields'
import { PhotoPicker } from '../components/PhotoPicker'
import { TeamSelect } from '../components/TeamSelect'
import { PositionsEditor, isEmptyPosition, newPositionDraft, positionPrice, type PositionDraft } from '../components/PositionsEditor'
import { uploadPhotos } from '../lib/photos'
import { useTeams } from '../lib/teams'
import { supabase } from '../lib/supabase'
import {
  SERVICE_AREAS,
  TICKET_TYPES,
  TYPE_LABEL,
  defaultArea,
  displayName,
  type ServiceArea,
  type TicketType,
  isPlannerRole,
  canUseCrm,
} from '../lib/types'
import { ensureCustomer, type Customer } from '../lib/customers'
import { ProjectPicker } from '../components/ProjectPicker'
import type { Project, ProjectAddress } from '../lib/projects'
import { useProfiles } from '../lib/useProfiles'

export function NewTicket() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { profile } = useAuth()
  const { leads } = useProfiles()
  const { teams, teamById } = useTeams()
  const canPlan = isPlannerRole(profile?.role)
  const crm = canUseCrm(profile?.role)

  const [type, setType] = useState<TicketType>(
    TICKET_TYPES.includes(params.get('art') as TicketType) ? (params.get('art') as TicketType) : 'restarbeit',
  )
  // aus einem 3E-Auftrag (Liste „Aufträge aus 3E“): /neu?art=montageauftrag&auftrag=<Nummer>&titel=<Bezeichnung>
  const [title, setTitle] = useState(() => (params.get('titel') ?? '').slice(0, 150))
  const [description, setDescription] = useState('')
  const [orderNumber, setOrderNumber] = useState(() => (params.get('auftrag') ?? '').slice(0, 50))
  const [positionNumber, setPositionNumber] = useState('')
  const [area, setArea] = useState<ServiceArea | null>(
    SERVICE_AREAS.includes(params.get('bereich') as ServiceArea) ? (params.get('bereich') as ServiceArea) : null,
  )
  const [positions, setPositions] = useState<PositionDraft[]>(() => [newPositionDraft()])
  const [cust, setCust] = useState<CustomerData>(emptyCustomer)
  const [billingAddr, setBillingAddr] = useState<AltAddress>(emptyAddress)
  const [projectAddr, setProjectAddr] = useState<AltAddress>(emptyAddress)
  const [assignedTo, setAssignedTo] = useState('')
  const [teamId, setTeamId] = useState(params.get('team') ?? '')
  const [montageDate, setMontageDate] = useState(params.get('datum') ?? '')
  const [montageTime, setMontageTime] = useState('')
  const [calcMen, setCalcMen] = useState('')
  const [calcDays, setCalcDays] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const einsatz = type !== 'qm'

  // Bauvorhaben: ausgewählt (project) oder neu mit Pflicht-Bezeichnung (newProjectName) an der Kundenadresse
  // bzw. an einer eigenen Adresse (projectAddr). Die Adresse des Bauvorhabens ist der Einsatzort.
  const [project, setProject] = useState<Project | null>(null)
  const [newProjectName, setNewProjectName] = useState('')
  const siteAddress: ProjectAddress = projectAddr.different
    ? { street: projectAddr.street, house_no: projectAddr.house_no, zip: projectAddr.zip, city: projectAddr.city, country: projectAddr.country }
    : { street: cust.customer_street, house_no: cust.customer_house_no, zip: cust.customer_zip, city: cust.customer_city, country: cust.customer_country }

  // Aus der Kundenakte: /neu?kunde=<id> übernimmt den Kunden
  const fromCustomer = params.get('kunde')
  useEffect(() => {
    if (!fromCustomer) return
    supabase
      .from('customers')
      .select('*')
      .eq('id', Number(fromCustomer))
      .maybeSingle()
      .then(({ data }) => data && setCust(customerFromMaster(data as Customer)))
  }, [fromCustomer])

  // Aus dem Bauvorhaben: /neu?bv=<id> übernimmt das Bauvorhaben und (wenn eindeutig) den Bauherrn als Kunden
  const fromProject = params.get('bv')
  useEffect(() => {
    if (!fromProject) return
    supabase
      .from('projects')
      .select('*, project_customers(role, customers(*))')
      .eq('id', Number(fromProject))
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        const { project_customers: pcs, ...p } = data as Project & { project_customers: { role: string; customers: Customer | null }[] }
        setProject(p)
        const owners = pcs.filter((x) => x.role === 'bauherr' && x.customers)
        if (owners.length === 1) setCust((c) => (c.customer_id || c.customer_name ? c : customerFromMaster(owners[0].customers!)))
      })
  }, [fromProject])

  async function submit(e: FormEvent) {
    e.preventDefault()
    // Preise vor dem Anlegen prüfen, damit kein halber Auftrag entsteht
    const filled = positions.filter((p) => !isEmptyPosition(p))
    let prices: ReturnType<typeof positionPrice>[] = []
    try {
      if (canPlan) prices = filled.map((p, i) => positionPrice(p, i + 1))
    } catch (err) {
      setError((err as Error).message)
      return
    }
    setBusy(true)
    if (einsatz && !(await confirmAddresses(addressesToCheck(cust, crm && !project ? projectAddr : emptyAddress, billingAddr)))) {
      setBusy(false)
      return
    }
    setError('')
    const customer = einsatz ? (crm ? await ensureCustomer(cust) : cust) : emptyCustomer
    // Neues Bauvorhaben mit der eingegebenen Bezeichnung anlegen; der Kunde wird beim Speichern des Auftrags verknüpft
    let projectId = project?.id ?? null
    if (einsatz && crm && !project) {
      const { data: created, error: projErr } = await supabase
        .from('projects')
        .insert({
          name: newProjectName.trim(),
          street: siteAddress.street.trim(),
          house_no: siteAddress.house_no.trim(),
          zip: siteAddress.zip.trim(),
          city: siteAddress.city.trim(),
          country: siteAddress.country.trim() || emptyAddress.country,
        })
        .select('*')
        .single()
      if (projErr || !created) {
        setError(`Bauvorhaben konnte nicht angelegt werden: ${projErr?.message ?? ''}`)
        setBusy(false)
        return
      }
      // falls der Auftrag gleich scheitert, beim nächsten Versuch dieses Bauvorhaben nehmen statt ein zweites anzulegen
      setProject(created as Project)
      projectId = created.id
    }
    const { data, error } = await supabase
      .from('tickets')
      .insert({
        ticket_type: type,
        service_area: einsatz ? (area ?? defaultArea(type)) : null,
        title: title.trim(),
        description: einsatz ? '' : description.trim(),
        order_number: orderNumber.trim(),
        position_number: einsatz ? '' : positionNumber.trim(),
        ...customerColumns(customer),
        ...(einsatz && projectId ? { project_id: projectId } : {}),
        site_address: '',
        ...addressColumns(einsatz ? billingAddr : emptyAddress, 'billing'),
        assigned_to: !einsatz && assignedTo ? assignedTo : null,
        team_id: einsatz && canPlan && teamId ? Number(teamId) : null,
        montage_date: einsatz && canPlan && montageDate ? montageDate : null,
        montage_time: einsatz && canPlan && montageTime ? montageTime : null,
        // nur senden, wenn ausgefüllt (Spalten gibt es erst nach dem SQL-Update)
        ...(type === 'montageauftrag' && (calcMen || calcDays) ? calcTimeColumns(calcMen, calcDays) : {}),
      })
      .select('id')
      .single()
    if (error || !data) {
      setError(error?.message ?? 'Auftrag konnte nicht angelegt werden.')
      setBusy(false)
      return
    }
    const posRows = filled.map((p, i) => ({
      ticket_id: data.id,
      sort: i,
      position_number: String(i + 1),
      description: p.description.trim(),
      article_id: p.article_id ?? null,
      ...prices[i],
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
      alert(`Auftrag wurde angelegt, aber nicht alle Fotos konnten hochgeladen werden: ${(err as Error).message}`)
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
      {einsatz && (
        <>
          <CustomerFields value={cust} onChange={setCust} crm={crm} />
          {crm && (
            <ProjectPicker
              value={project}
              onChange={setProject}
              customerId={cust.customer_id}
              newProject={{ name: newProjectName, onName: setNewProjectName, address: siteAddress }}
            >
              <AddressFields kind="project" value={projectAddr} onChange={setProjectAddr} />
            </ProjectPicker>
          )}
          <AddressFields kind="billing" value={billingAddr} onChange={setBillingAddr} />
        </>
      )}
      {type === 'montageauftrag' && <CalcTimeFields men={calcMen} days={calcDays} onMen={setCalcMen} onDays={setCalcDays} />}
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
          <PositionsEditor positions={positions} onChange={setPositions} withPhotos withPrices={canPlan} />
        </div>
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
