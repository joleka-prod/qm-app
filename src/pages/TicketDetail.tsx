import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { PhotoGallery } from '../components/PhotoGallery'
import { PhotoPicker } from '../components/PhotoPicker'
import { PositionPhotos } from '../components/PositionPhotos'
import { PositionsEditor, isEmptyPosition, newPositionDraft, positionPrice, positionToDraft, type PositionDraft } from '../components/PositionsEditor'
import { OrderChain } from '../components/OrderChain'
import { SignaturePad, canvasToBlob } from '../components/SignaturePad'
import { TeamSelect } from '../components/TeamSelect'
import { WeekSelect } from '../components/WeekSelect'
import { CalcTimeFields, calcTimeColumns } from '../components/CalcTimeFields'
import { AppointmentCard } from '../components/AppointmentCard'
import { BillingCard } from '../components/BillingCard'
import { SelfCostCard } from '../components/SelfCostCard'
import { TimeCard, withPending, type TimeEntry } from '../components/TimeCard'
import { DistanceLine } from '../components/DistanceLine'
import { confirmAddresses } from '../lib/addressCheck'
import { AddressFields, CustomerFields, customerClears, addressesToCheck, addressColumns, customerColumns, customerOf, emptyCustomer, type CustomerData, addressComplete, addressLine, addressOf, emptyAddress, type AltAddress } from '../components/AddressFields'
import { StatusBadge, TypeBadge } from '../components/StatusBadge'
import { deletePhoto, signedUrls, uploadPhotos, uploadSignature } from '../lib/photos'
import { sendReport } from '../lib/reportMail'
import { loadCrew, loadTicketCore, loadTimeEntries } from '../lib/loaders'
import { rpcAt } from '../lib/clock'
import { pendingPhotos, useOfflineSynced } from '../lib/offline'
import { supabase } from '../lib/supabase'
import { useTeams } from '../lib/teams'
import {
  AREA_LABEL,
  appointmentMoveWarning,
  TYPE_LABEL,
  displayName,
  formatDate,
  isEmail,
  formatDay,
  formatManDays,
  formatTime,
  manDays,
  weekLabel,
  isEinsatz,
  orderRef,
  statusLabel,
  ticketNo,
  type DeletionRequest,
  type ServiceArea,
  type Ticket,
  type TicketEvent,
  type TicketPhoto,
  type PositionState,
  type TicketPosition,
  type TicketStatus,
  isPlannerRole,
  canUseCrm,
  formatEuro,
} from '../lib/types'
import { ensureCustomer } from '../lib/customers'
import { ProjectPicker } from '../components/ProjectPicker'
import { projectAddress, projectLabel, type Project } from '../lib/projects'
import { useProfiles } from '../lib/useProfiles'

const EVENT_LABEL: Record<string, string> = {
  erstellt: 'Erstellt',
  folgeauftrag: 'Folgeauftrag erstellt:',
  selbstkosten: 'Selbstkosten berechnet:',
  position_ergaenzt: 'Position ergänzt:',
  aus_auftrag: 'Als Folgeauftrag erstellt aus',
  eingeplant: 'Eingeplant:',
  kw_vorgemerkt: 'Vorgemerkt für',
  zur_berechnung: 'Zur Berechnung weitergeleitet',
  berechnet: 'Berechnet:',
  berechnung_geoeffnet: 'Berechnung wieder geöffnet',
  termin_angemeldet: 'Termin bei Kunde angemeldet:',
  termin_bestaetigt: 'Termin von Kunde bestätigt:',
  termin_zurueckgesetzt: 'Termin-Anmeldung aufgehoben:',
  bericht: 'Arbeitsbericht bearbeitet',
  unterschrift: 'Kunde hat unterschrieben:',
  unterschrift_entfernt: 'Unterschrift entfernt',
  bericht_gesendet: 'Bericht per E-Mail gesendet an',
  bereich: 'Bereich geändert auf',
  zugewiesen: 'Zugewiesen an',
  ursache: 'Ursache bearbeitet',
  massnahme: 'Maßnahme bearbeitet',
  auftrag: 'Auftrag/Position geändert:',
  status: 'Status geändert auf',
  pruefhinweis: 'Prüfhinweis',
  loeschantrag: 'Löschung beantragt:',
  loeschantrag_zurueck: 'Löschantrag zurückgezogen',
  loeschantrag_abgelehnt: 'Löschantrag abgelehnt',
}

export function TicketDetail() {
  const { id } = useParams()
  const ticketId = Number(id)
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { byId, leads, profiles } = useProfiles()
  const { teams, teamById } = useTeams()
  const [crew, setCrew] = useState<string[]>([])
  const [crewLead, setCrewLead] = useState('')

  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [photos, setPhotos] = useState<TicketPhoto[]>([])
  const [events, setEvents] = useState<TicketEvent[]>([])
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [cause, setCause] = useState('')
  const [action, setAction] = useState('')
  const [reviewNote, setReviewNote] = useState('')
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [editing, setEditing] = useState(false)
  const [deletion, setDeletion] = useState<DeletionRequest | null>(null)
  const [requestingDeletion, setRequestingDeletion] = useState(false)
  const [deletionReason, setDeletionReason] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [orderNumber, setOrderNumber] = useState('')
  const [positionNumber, setPositionNumber] = useState('')
  const [cust, setCust] = useState<CustomerData>(emptyCustomer)
  const [wantsEmail, setWantsEmail] = useState(false)
  const [signEmail, setSignEmail] = useState('')
  const [billingAddr, setBillingAddr] = useState<AltAddress>(emptyAddress)
  const [teamId, setTeamId] = useState('')
  const [montageDate, setMontageDate] = useState('')
  const [plannedWeek, setPlannedWeek] = useState('')
  const [calcMen, setCalcMen] = useState('')
  const [calcDays, setCalcDays] = useState('')
  const [montageTime, setMontageTime] = useState('')
  const [report, setReport] = useState('')
  const loadedReport = useRef('')
  const [area, setArea] = useState<ServiceArea | ''>('')
  const [signerName, setSignerName] = useState('')
  const [hasInk, setHasInk] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signatureUrl, setSignatureUrl] = useState('')
  const [reportPdfUrl, setReportPdfUrl] = useState('')
  const signatureCanvas = useRef<HTMLCanvasElement>(null)
  const [positions, setPositions] = useState<TicketPosition[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [projectDraft, setProjectDraft] = useState<Project | null>(null)
  const [positionDrafts, setPositionDrafts] = useState<PositionDraft[] | null>(null)
  // Monteure ergänzen nur neue Positionen, bestehende bleiben unverändert
  const [appendOnly, setAppendOnly] = useState(false)
  const [reasonFor, setReasonFor] = useState<number | null>(null)
  const [mailStatus, setMailStatus] = useState('')
  const [reasonText, setReasonText] = useState('')

  const load = useCallback(async () => {
    const [t, p, e, d, pos] = await loadTicketCore(ticketId)
    if (!t.data) {
      setNotFound(true)
      return
    }
    const tk = t.data as Ticket
    setTicket(tk)
    setCause(tk.cause)
    setAction(tk.corrective_action)
    setTitle(tk.title)
    setDescription(tk.description)
    setOrderNumber(tk.order_number)
    setPositionNumber(tk.position_number)
    setCust(customerOf(tk))
    setBillingAddr(addressOf(tk, 'billing'))
    setTeamId(tk.team_id ? String(tk.team_id) : '')
    if (tk.team_id && tk.montage_date) {
      const { data: m } = await loadCrew(tk.team_id, tk.montage_date)
      setCrew((m ?? []).map((x) => x.installer_id as string))
      setCrewLead((m ?? []).find((x) => x.lead)?.installer_id ?? '')
    } else {
      setCrew([])
      setCrewLead('')
    }
    setMontageDate(tk.montage_date ?? '')
    setPlannedWeek(tk.planned_week ?? '')
    setCalcMen(tk.calc_men ? String(tk.calc_men) : '')
    setCalcDays(tk.calc_days ? String(tk.calc_days) : '')
    setMontageTime(formatTime(tk.montage_time))
    // Ungespeicherten Bericht nicht überschreiben, wenn z. B. nur eine Position abgehakt wurde
    setReport((cur) => (cur === loadedReport.current ? tk.work_report : cur))
    loadedReport.current = tk.work_report
    setArea(tk.service_area ?? '')
    const files = [tk.signature_path, tk.report_pdf_path].filter((f): f is string => !!f)
    const fileUrls = await signedUrls(files).catch(() => ({}) as Record<string, string>)
    setSignatureUrl(tk.signature_path ? (fileUrls[tk.signature_path] ?? '') : '')
    setReportPdfUrl(tk.report_pdf_path ? (fileUrls[tk.report_pdf_path] ?? '') : '')
    setPhotos((p.data ?? []) as TicketPhoto[])
    setEvents((e.data ?? []) as TicketEvent[])
    setDeletion(d.data as DeletionRequest | null)
    setPositions((pos.data ?? []) as TicketPosition[])
    // Bauvorhaben sieht jeder, der den Auftrag sieht (auch Monteure); ändern nur CRM-Rollen
    if (tk.project_id) {
      const { data: pr } = await supabase.from('projects').select('*').eq('id', tk.project_id).maybeSingle()
      setProject(pr as Project | null)
      setProjectDraft(pr as Project | null)
    }
  }, [ticketId, profile?.role])

  useEffect(() => {
    load()
  }, [load])
  useOfflineSynced(load)

  if (notFound) return <p>Auftrag nicht gefunden. <Link to="/">Zur Übersicht</Link></p>
  if (!ticket || !profile) return <p className="muted">Lädt…</p>

  const isAdmin = profile.role === 'admin'
  const isLead = ticket.assigned_to === profile.id
  const closed = ticket.status === 'abgeschlossen'
  const canWork = !closed && (isLead || isAdmin) && ticket.assigned_to !== null
  const einsatz = isEinsatz(ticket)
  const isPlanner = isPlannerRole(profile.role)
  // Monteur ist, wer am Einsatztag im eingeplanten Team ist
  const isInstaller = crew.includes(profile.id)
  const canPlan = einsatz && isPlanner && !closed
  const canEditBase =
    isAdmin || (einsatz && isPlanner && !closed) || (ticket.created_by === profile.id && ticket.status === 'neu')
  const canRequestDeletion = ticket.created_by === profile.id || isLead || isPlanner
  const canEditRef = canEditBase || (isLead && !closed)
  const calc = calcTimeColumns(calcMen, calcDays)
  const calcChanged = calc.calc_men !== (ticket.calc_men ?? null) || calc.calc_days !== (ticket.calc_days == null ? null : Number(ticket.calc_days))
  const planDirty =
    teamId !== (ticket.team_id ? String(ticket.team_id) : '') ||
    montageDate !== (ticket.montage_date ?? '') ||
    montageTime !== formatTime(ticket.montage_time) ||
    area !== (ticket.service_area ?? '') ||
    plannedWeek !== (ticket.planned_week ?? '') ||
    calcChanged
  const canEditPositions =
    einsatz && (isAdmin || (isPlanner && !closed) || (ticket.created_by === profile.id && ticket.status === 'neu'))
  const canCheckPositions = einsatz && !closed && (isInstaller || canEditPositions)
  // Planer tragen Menge, Einheit und Einzelpreis gleich mit ein, solange nicht berechnet
  const withPrices = isPlanner && !appendOnly && ticket.billing_state !== 'berechnet'
  const canAddPositions = einsatz && !closed && isInstaller && !canEditPositions
  const canDeletePhoto = (p: TicketPhoto) => isAdmin || (p.uploaded_by === profile.id && !closed)
  const openPositions = positions.filter((p) => p.state === 'offen').length
  const donePositions = positions.filter((p) => p.state === 'erledigt').length
  const notDonePositions = positions.filter((p) => p.state === 'nicht_erledigt').length
  const canSign = einsatz && (isAdmin || (!closed && (isInstaller || isPlanner)))
  // Arbeitsbericht schreiben und erledigt melden: Monteure im Team und Admin (auch am PC)
  const canReport = einsatz && !closed && (isInstaller || isAdmin)
  const dirty = cause !== ticket.cause || action !== ticket.corrective_action

  async function update(patch: Partial<Ticket>) {
    setBusy(true)
    setError('')
    const { error } = await supabase.from('tickets').update(patch).eq('id', ticketId)
    if (error) setError(error.message)
    await load()
    setBusy(false)
    return !error
  }

  async function setPositionState(p: TicketPosition, state: PositionState, reason = '') {
    setBusy(true)
    setError('')
    const { error } = await supabase.from('ticket_positions').update({ state, reason }).eq('id', p.id)
    if (error) setError(error.message)
    else setReasonFor(null)
    await load()
    setBusy(false)
  }

  async function savePositions() {
    if (!positionDrafts) return
    setBusy(true)
    setError('')
    try {
      const keep = positionDrafts.filter((p) => !isEmptyPosition(p))
      const offset = appendOnly ? positions.length : 0
      // Fehleingaben vor dem Speichern melden
      if (withPrices) keep.forEach((p, i) => positionPrice(p, offset + i + 1))
      const removed = appendOnly ? [] : positions.filter((p) => !keep.some((k) => k.id === p.id)).map((p) => p.id)
      if (removed.length > 0) {
        const { error } = await supabase.from('ticket_positions').delete().in('id', removed)
        if (error) throw error
      }
      for (const [i, p] of keep.entries()) {
        const row = {
          sort: offset + i,
          position_number: String(offset + i + 1),
          description: p.description.trim(),
          article_id: p.article_id ?? null,
          ...(withPrices ? positionPrice(p, offset + i + 1) : {}),
        }
        const { error } = p.id
          ? await supabase.from('ticket_positions').update(row).eq('id', p.id)
          : await supabase.from('ticket_positions').insert({ ...row, ticket_id: ticketId })
        if (error) throw error
      }
      setPositionDrafts(null)
    } catch (err) {
      setError((err as Error).message)
    }
    await load()
    setBusy(false)
  }

  async function mailReport(force: boolean) {
    setBusy(true)
    setError('')
    setMailStatus('Bericht wird gesendet …')
    try {
      await sendReport(ticketId, force)
      setMailStatus('')
    } catch (err) {
      setMailStatus(`Versand fehlgeschlagen: ${(err as Error).message}`)
    }
    await load()
    setBusy(false)
  }

  async function closeJob() {
    const wantsMail = ticket?.report_by_email && !ticket.report_sent_at
    if (isInstaller && profile) {
      // laufende Auftragszeit jetzt beenden (offline würde sie sonst erst bei der Übertragung gestoppt)
      const [, mine] = await loadTimeEntries(ticketId, profile.id)
      if (withPending([], (mine.data ?? null) as TimeEntry | null, ticketId, profile.id).running?.ticket_id === ticketId) {
        await rpcAt('stop_time_entry')
      }
    }
    if ((await update({ work_report: report, status: 'abgeschlossen' })) && wantsMail) await mailReport(false)
  }

  async function saveSignature() {
    const canvas = signatureCanvas.current
    if (!canvas) return
    setBusy(true)
    setError('')
    try {
      const path = await uploadSignature(ticketId, await canvasToBlob(canvas))
      const { error } = await supabase
        .from('tickets')
        .update({
          signature_path: path,
          signer_name: signerName.trim(),
          report_by_email: wantsEmail,
          ...(wantsEmail ? { customer_email: signEmail.trim() } : {}),
          // noch nicht gespeicherten Arbeitsbericht nicht verlieren
          ...(canReport && report !== ticket?.work_report ? { work_report: report } : {}),
        })
        .eq('id', ticketId)
      if (error) throw error
      setSigning(false)
      setHasInk(false)
    } catch (err) {
      setError((err as Error).message)
    }
    await load()
    setBusy(false)
  }

  async function addPhotos() {
    setBusy(true)
    setError('')
    try {
      await uploadPhotos(ticketId, newFiles)
      setNewFiles([])
    } catch (err) {
      setError((err as Error).message)
    }
    await load()
    setBusy(false)
  }

  async function addPositionPhotos(positionId: number, files: File[]) {
    setBusy(true)
    setError('')
    try {
      await uploadPhotos(ticketId, files, positionId)
    } catch (err) {
      setError((err as Error).message)
    }
    await load()
    setBusy(false)
  }

  async function removePhoto(p: TicketPhoto) {
    try {
      await deletePhoto(p.id, p.storage_path)
    } catch (err) {
      setError((err as Error).message)
    }
    await load()
  }

  async function requestDeletion() {
    setBusy(true)
    setError('')
    const { error } = await supabase
      .from('deletion_requests')
      .insert({ ticket_id: ticketId, reason: deletionReason.trim() })
    if (error) setError(error.message)
    else {
      setRequestingDeletion(false)
      setDeletionReason('')
    }
    await load()
    setBusy(false)
  }

  async function dropDeletionRequest() {
    setBusy(true)
    setError('')
    const { error } = await supabase.from('deletion_requests').delete().eq('ticket_id', ticketId)
    if (error) setError(error.message)
    await load()
    setBusy(false)
  }

  async function removeTicket() {
    if (!confirm('Auftrag mit allen Fotos endgültig löschen? Das kann nicht rückgängig gemacht werden.')) return
    if (photos.length > 0) {
      await supabase.storage.from('ticket-photos').remove(photos.map((p) => p.storage_path))
    }
    const { error } = await supabase.from('tickets').delete().eq('id', ticketId)
    if (error) setError(error.message)
    else navigate('/', { replace: true })
  }

  // Monteure sehen die Auftragszeit ganz oben
  const timeOnTop = profile.role === 'monteur'
  const timeCard = (
    <TimeCard ticket={ticket} me={profile.id} isInstaller={isInstaller} isPlanner={isPlanner} isAdmin={isAdmin} byId={byId} />
  )

  return (
    <div className="detail">
      <Link to="/" className="back">← Übersicht</Link>

      {einsatz && timeOnTop && timeCard}

      <section className="card">
        <div className="ticket-row-top">
          <span className="ticket-no">
            {ticketNo(ticket.id, ticket.ticket_type)} <TypeBadge type={ticket.ticket_type} />
          </span>
          <StatusBadge status={ticket.status} type={ticket.ticket_type} appointment={ticket.appointment_state} billing={ticket.billing_state} />
        </div>
        {editing ? (
          <div className="form">
            {canEditBase && (
              <label>
                Kurzbeschreibung
                <input value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} />
              </label>
            )}
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
            {einsatz && canEditBase && (
              <>
                <CustomerFields value={cust} onChange={setCust} crm={canUseCrm(profile.role)} />
                <AddressFields kind="billing" value={billingAddr} onChange={setBillingAddr} />
                {canUseCrm(profile.role) && project && (
                  <ProjectPicker value={projectDraft} onChange={(p) => p && setProjectDraft(p)} customerId={cust.customer_id} />
                )}
              </>
            )}
            {canEditBase && !einsatz && (
              <label>
                Beschreibung
                <textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>
            )}
            <div className="actions">
              <button
                onClick={() => {
                  setEditing(false)
                  setTitle(ticket.title)
                  setDescription(ticket.description)
                  setOrderNumber(ticket.order_number)
                  setPositionNumber(ticket.position_number)
                  setCust(customerOf(ticket))
                  setBillingAddr(addressOf(ticket, 'billing'))
                  setProjectDraft(project)
                }}
              >
                Abbrechen
              </button>
              <button
                className="primary"
                disabled={busy || !title.trim() || (einsatz && ((!!cust.customer_email.trim() && !isEmail(cust.customer_email)) || !addressComplete(billingAddr, 'billing')))}
                onClick={async () => {
                  const ref = { order_number: orderNumber.trim(), position_number: positionNumber.trim() }
                  const base = { ...ref, title: title.trim(), description: description.trim() }
                  if (einsatz && canEditBase) {
                    const before = addressesToCheck(customerOf(ticket), emptyAddress, addressOf(ticket, 'billing'))
                    if (!(await confirmAddresses(addressesToCheck(cust, emptyAddress, billingAddr), before))) return
                  }
                  const linked = einsatz && canEditBase && canUseCrm(profile.role) ? await ensureCustomer(cust) : cust
                  const unlink = customerClears(customerOf(ticket), linked)
                  const site = einsatz ? { ...customerColumns(linked), ...unlink, ...addressColumns(billingAddr, 'billing') } : {}
                  const moved = einsatz && projectDraft && projectDraft.id !== ticket.project_id ? { project_id: projectDraft.id } : {}
                  const patch = canEditBase ? { ...base, ...site, ...moved } : ref
                  if (await update(patch)) setEditing(false)
                }}
              >
                Speichern
              </button>
            </div>
          </div>
        ) : (
          <>
            <h1 className="ticket-heading">{ticket.title}</h1>
            {(ticket.customer_number || orderRef(ticket)) && (
              <p className="order-ref">
                {[ticket.customer_number && `Kundennr. ${ticket.customer_number}`, orderRef(ticket)].filter(Boolean).join(' · ')}
              </p>
            )}
            {einsatz && (ticket.customer_name || ticket.site_address || ticket.customer_email || ticket.customer_phone || ticket.customer_mobile) && (
              <p className="small">
                <span className="muted">Kunde: </span>
                {ticket.customer_name}
                {ticket.customer_name && ticket.site_address && ', '}
                {ticket.site_address && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ticket.site_address)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {ticket.site_address.replace(/\s*\n\s*/g, ', ')}
                  </a>
                )}
                {[ticket.customer_phone, ticket.customer_mobile].filter(Boolean).map((tel) => (
                  <span key={tel}>
                    {' · '}
                    <a href={`tel:${tel.replace(/[^\d+]/g, '')}`}>{tel === ticket.customer_mobile ? '📱' : '☎'} {tel}</a>
                  </span>
                ))}
                {ticket.customer_email && (
                  <>
                    {' · '}
                    <a href={`mailto:${ticket.customer_email}`}>{ticket.customer_email}</a>
                  </>
                )}
                {ticket.customer_id && canUseCrm(profile.role) && (
                  <>
                    {' · '}
                    <Link to={`/kunden/${ticket.customer_id}`}>Kundenakte</Link>
                  </>
                )}
              </p>
            )}
            {einsatz && project && (
              <p className="small">
                <span className="muted">Bauvorhaben: </span>
                {canUseCrm(profile.role) ? (
                  <Link to={`/bauvorhaben/${project.id}`}>{projectLabel(project)}</Link>
                ) : (
                  projectLabel(project)
                )}
                {projectAddress(project) && (
                  <>
                    {' · '}
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(projectAddress(project))}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {projectAddress(project)}
                    </a>
                  </>
                )}
              </p>
            )}
            {einsatz && ticket.billing_address_different && (
              <p className="small">
                <span className="muted">Rechnungsadresse: </span>
                {addressLine(addressOf(ticket, 'billing'))}
              </p>
            )}
            {einsatz && <DistanceLine ticket={ticket} project={project} onChanged={load} />}
            <p className="muted small">
              Erstellt {formatDate(ticket.created_at)} von {displayName(byId[ticket.created_by])}
              {ticket.closed_at && <> · {einsatz ? 'Erledigt' : 'Abgeschlossen'} {formatDate(ticket.closed_at)}</>}
            </p>
            {ticket.description ? <p className="pre">{ticket.description}</p> : !einsatz && <p className="muted">Keine Beschreibung.</p>}
            {canEditRef && (
              <button className="link" onClick={() => setEditing(true)}>
                {canEditBase ? 'Bearbeiten' : 'Auftrag/Position bearbeiten'}
              </button>
            )}
          </>
        )}
      </section>

      {einsatz && (
        <section className="card">
          <h2>
            Positionen
            {positions.length > 0 && (
              <span className="muted small">
                {' · '}
                {donePositions} erledigt
                {notDonePositions > 0 && ` · ${notDonePositions} nicht erledigt`}
                {openPositions > 0 && ` · ${openPositions} offen`}
              </span>
            )}
          </h2>
          {positionDrafts ? (
            <div className="form">
              {appendOnly && <p className="muted small">Neue Positionen werden an die bestehenden angehängt (ab Pos. {positions.length + 1}).</p>}
              <PositionsEditor positions={positionDrafts} onChange={setPositionDrafts} withPrices={withPrices} />
              <div className="actions">
                <button disabled={busy} onClick={() => setPositionDrafts(null)}>Abbrechen</button>
                <button className="primary" disabled={busy} onClick={savePositions}>Positionen speichern</button>
              </div>
            </div>
          ) : (
            <>
              {positions.length === 0 ? (
                <p className="muted">Keine Positionen.</p>
              ) : (
                <ul className="position-list">
                  {positions.map((p) => (
                    <li key={p.id} className={`pos-${p.state}`}>
                      <div className="position-text">
                        {p.position_number && <strong>Pos. {p.position_number}</strong>}
                        {p.position_number && p.description && ' – '}
                        <span className="pre">{p.description}</span>
                      </div>
                      {isPlanner && p.price != null && (
                        <div className="muted small">
                          {String(p.quantity).replace('.', ',')} {p.unit} × {formatEuro(p.price)} = {formatEuro(Math.round(p.quantity * p.price * 100) / 100)}
                        </div>
                      )}
                      {canCheckPositions ? (
                        <div className="position-state" role="group" aria-label={`Status Position ${p.position_number || p.sort + 1}`}>
                          <button
                            type="button"
                            className={p.state === 'erledigt' && reasonFor !== p.id ? 'active state-ok' : ''}
                            aria-pressed={p.state === 'erledigt' && reasonFor !== p.id}
                            disabled={busy}
                            onClick={() => {
                              if (reasonFor === p.id) setReasonFor(null)
                              if (p.state === 'erledigt' && reasonFor !== p.id) {
                                // Nur Planer dürfen eine Position wieder auf offen setzen
                                if (canEditPositions) setPositionState(p, 'offen')
                                return
                              }
                              setPositionState(p, 'erledigt')
                            }}
                          >
                            ✓ Erledigt
                          </button>
                          <button
                            type="button"
                            className={p.state === 'nicht_erledigt' || reasonFor === p.id ? 'active state-no' : ''}
                            aria-pressed={p.state === 'nicht_erledigt' || reasonFor === p.id}
                            disabled={busy}
                            onClick={() => {
                              if (reasonFor === p.id) return setReasonFor(null)
                              setReasonText(p.reason)
                              setReasonFor(p.id)
                            }}
                          >
                            ✗ Nicht erledigt
                          </button>
                        </div>
                      ) : (
                        p.state !== 'offen' && (
                          <div className={`position-result ${p.state === 'erledigt' ? 'state-ok' : 'state-no'}`}>
                            {p.state === 'erledigt' ? '✓ Erledigt' : '✗ Nicht erledigt'}
                          </div>
                        )
                      )}
                      {reasonFor === p.id ? (
                        <div className="form position-reason-form">
                          <label>
                            Begründung *
                            <textarea
                              rows={2}
                              autoFocus
                              value={reasonText}
                              maxLength={1000}
                              placeholder="Warum wurde die Position nicht erledigt?"
                              onChange={(e) => setReasonText(e.target.value)}
                            />
                          </label>
                          <div className="actions">
                            {p.state === 'nicht_erledigt' && canEditPositions && (
                              <button className="link" disabled={busy} onClick={() => setPositionState(p, 'offen')}>
                                Zurück auf offen
                              </button>
                            )}
                            <button disabled={busy} onClick={() => setReasonFor(null)}>Abbrechen</button>
                            <button
                              className="primary"
                              disabled={busy || !reasonText.trim()}
                              onClick={() => setPositionState(p, 'nicht_erledigt', reasonText)}
                            >
                              Speichern
                            </button>
                          </div>
                        </div>
                      ) : (
                        p.state === 'nicht_erledigt' && <p className="position-reason pre">Begründung: {p.reason}</p>
                      )}
                      {p.state !== 'offen' && p.done_by && (
                        <div className="muted small">
                          {p.state === 'erledigt' ? 'Erledigt' : 'Nicht erledigt'} von {displayName(byId[p.done_by])}
                          {p.done_at && `, ${formatDate(p.done_at)}`}
                        </div>
                      )}
                      <PositionPhotos
                        photos={photos.filter((f) => f.position_id === p.id)}
                        canAdd={!closed}
                        canDelete={canDeletePhoto}
                        onAdd={(files) => addPositionPhotos(p.id, files)}
                        onDelete={removePhoto}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {canAddPositions && (
                <button
                  className="link"
                  onClick={() => {
                    setAppendOnly(true)
                    setPositionDrafts([newPositionDraft()])
                  }}
                >
                  + Position ergänzen
                </button>
              )}
              {canEditPositions && (
                <button
                  className="link"
                  onClick={() => {
                    setAppendOnly(false)
                    setPositionDrafts(
                      positions.length > 0
                        ? positions.map(positionToDraft)
                        : [newPositionDraft()],
                    )
                  }}
                >
                  Positionen bearbeiten
                </button>
              )}
            </>
          )}
        </section>
      )}

      {ticket.billing_state !== 'keine' && isPlanner && (
        <BillingCard ticket={ticket} positions={positions} byId={byId} canEdit={isPlanner} isAdmin={isAdmin} onChanged={load} />
      )}

      <section className="card">
        <h2>{einsatz ? 'Fotos zum Auftrag' : 'Fotos'}</h2>
        <PhotoGallery
          photos={photos.filter((p) => p.position_id === null)}
          canDelete={canDeletePhoto}
          onDelete={removePhoto}
        />
        {pendingPhotos(ticketId) > 0 && (
          <p className="small muted">
            {pendingPhotos(ticketId)} {pendingPhotos(ticketId) === 1 ? 'Foto wartet' : 'Fotos warten'} auf Übertragung.
          </p>
        )}
        {!closed && (
          <div className="add-photos">
            <PhotoPicker files={newFiles} onChange={setNewFiles} />
            {newFiles.length > 0 && (
              <button className="primary" disabled={busy} onClick={addPhotos}>
                {busy ? 'Lädt hoch…' : `${newFiles.length} Foto(s) hochladen`}
              </button>
            )}
          </div>
        )}
      </section>

      {einsatz && profile.role !== 'monteur' && (
        <section className="card">
          <h2>Einsatzplanung</h2>
          {canPlan ? (
            <div className="form">
              {/* Bereich ergibt sich aus dem Team (Zuordnung im Kalender), Fabian 2026-10-25 */}
              {ticket.ticket_type === 'montageauftrag' && (
                <CalcTimeFields men={calcMen} days={calcDays} onMen={setCalcMen} onDays={setCalcDays} />
              )}
              {(ticket.ticket_type === 'montageauftrag' || plannedWeek) && (
                <label>
                  Vorgemerkt für (Vorplanung Montage)
                  <WeekSelect value={plannedWeek} onChange={setPlannedWeek} />
                </label>
              )}
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
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy || !planDirty}
                  onClick={() => {
                    const warning = appointmentMoveWarning(
                      ticket,
                      montageDate || null,
                      montageTime || null,
                      ticket.appointment_told_by ? displayName(byId[ticket.appointment_told_by]) : undefined,
                    )
                    if (warning && !confirm(warning)) return
                    update({
                      team_id: teamId ? Number(teamId) : null,
                      montage_date: montageDate || null,
                      montage_time: montageTime || null,
                      ...(area ? { service_area: area } : {}),
                      // erst senden, wenn geändert (Spalte gibt es erst nach dem SQL-Update)
                      ...(plannedWeek !== (ticket.planned_week ?? '') ? { planned_week: plannedWeek || null } : {}),
                      ...(calcChanged ? calc : {}),
                    })
                  }}
                >
                  Planung speichern
                </button>
              </div>
            </div>
          ) : ticket.team_id || ticket.montage_date || ticket.planned_week ? (
            <p>
              {ticket.team_id ? teamById[ticket.team_id]?.name : 'Kein Team'}
              {ticket.montage_date && <> · {formatDay(ticket.montage_date)}</>}
              {ticket.montage_time && <> · {formatTime(ticket.montage_time)} Uhr</>}
              {ticket.planned_week && !ticket.montage_date && <> · vorgemerkt {weekLabel(ticket.planned_week)}</>}
            </p>
          ) : (
            <p className="muted">Noch nicht eingeplant.</p>
          )}
          {!canPlan && !!manDays(ticket.calc_men, ticket.calc_days) && (
            <p>
              Kalkulierte Montagezeit: {ticket.calc_men} Mann × {Number(ticket.calc_days).toLocaleString('de-DE')} Tage ={' '}
              <strong>{formatManDays(manDays(ticket.calc_men, Number(ticket.calc_days))!)}</strong>
            </p>
          )}
          {ticket.team_id && ticket.montage_date && (
            <p className="small">
              {crew.length > 0 ? (
                <>
                  Monteure an dem Tag:{' '}
                  {crew.map((id) => displayName(byId[id]) + (id === crewLead ? ' (verantwortlich)' : '')).join(', ')}
                </>
              ) : (
                <span className="crew-missing">Für diesen Tag ist noch kein Monteur im Team eingeteilt (im Kalender zuordnen).</span>
              )}
            </p>
          )}
        </section>
      )}

      {einsatz && profile.role !== 'monteur' && (
        <AppointmentCard
          ticket={ticket}
          profiles={profiles}
          byId={byId}
          me={profile.id}
          canEdit={isPlanner}
          events={events}
          onChanged={load}
        />
      )}

      {einsatz && <OrderChain ticket={ticket} canCreate={isPlanner} />}

      {einsatz && !timeOnTop && timeCard}

      {einsatz && (
        <section className="card">
          <h2>Arbeitsbericht</h2>
          {canReport ? (
            <div className="form">
              <label>
                Was wurde gemacht?
                <textarea rows={4} value={report} onChange={(e) => setReport(e.target.value)} placeholder="z. B. Griff getauscht, Fenster neu eingestellt" />
              </label>
              <div className="actions">
                <button
                  disabled={busy || report === ticket.work_report || openPositions > 0}
                  onClick={() => update({ work_report: report })}
                >
                  Speichern
                </button>
              </div>
              {openPositions > 0 && (
                <p className="muted small">
                  Speichern und Erledigt melden erst möglich, wenn alle Positionen als erledigt oder nicht erledigt
                  abgehakt sind ({openPositions} offen).
                </p>
              )}
            </div>
          ) : ticket.work_report ? (
            <p className="pre">{ticket.work_report}</p>
          ) : (
            <p className="muted">Noch kein Bericht.</p>
          )}
        </section>
      )}

      {einsatz && (
        <section className="card">
          <h2>Kundenunterschrift</h2>
          {ticket.signature_path ? (
            <>
              {signatureUrl ? (
                <img className="signature-img" src={signatureUrl} alt="Unterschrift des Kunden" />
              ) : (
                !ticket.signed_at && <p className="small muted">Unterschrift ist im Handy gespeichert und wird übertragen, sobald wieder Empfang da ist.</p>
              )}
              <p className="small">
                {ticket.signer_name}
                {ticket.signed_at && <span className="muted"> · {formatDate(ticket.signed_at)}</span>}
              </p>
              <p className="small">
                {ticket.report_by_email
                  ? <>✉ Bericht per E-Mail gewünscht an <a href={`mailto:${ticket.customer_email}`}>{ticket.customer_email}</a></>
                  : <span className="muted">Kein Bericht per E-Mail gewünscht.</span>}
              </p>
              {ticket.report_by_email && ticket.report_sent_at && (
                <p className="small mail-ok">✓ Bericht gesendet am {formatDate(ticket.report_sent_at)}</p>
              )}
              {reportPdfUrl && (
                <p className="small">
                  <a href={reportPdfUrl} target="_blank" rel="noreferrer">📄 Gesendeten Bericht (PDF) ansehen</a>
                </p>
              )}
              {mailStatus && <p className={`small ${mailStatus.startsWith('Versand') ? 'mail-error' : 'muted'}`}>{mailStatus}</p>}
              {!mailStatus && ticket.report_by_email && !ticket.report_sent_at && ticket.report_send_error && (
                <p className="small mail-error">Versand fehlgeschlagen: {ticket.report_send_error}</p>
              )}
              {ticket.report_by_email && !closed && (
                <p className="small muted">Der Bericht wird automatisch verschickt, sobald der Auftrag als erledigt gemeldet ist.</p>
              )}
              <div className="signature-actions">
                {ticket.report_by_email && closed && (isPlanner || (isInstaller && !ticket.report_sent_at)) && (
                  <button className="link" disabled={busy} onClick={() => mailReport(!!ticket.report_sent_at)}>
                    {ticket.report_sent_at ? 'Bericht erneut senden' : 'Bericht jetzt senden'}
                  </button>
                )}
                {isAdmin && (
                  <button className="link signature-remove" disabled={busy} onClick={() => update({ signature_path: null })}>
                    Unterschrift entfernen
                  </button>
                )}
              </div>
            </>
          ) : canSign && signing ? (
            <div className="form">
              <p className="muted small">Bitte das Handy dem Kunden geben und mit dem Finger unterschreiben lassen.</p>
              <SignaturePad canvasRef={signatureCanvas} onChange={setHasInk} />
              <label>
                Name des Kunden *
                <input value={signerName} maxLength={100} onChange={(e) => setSignerName(e.target.value)} placeholder="Vorname Nachname" />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={wantsEmail}
                  onChange={(e) => {
                    setWantsEmail(e.target.checked)
                    // E-Mail aus den Kundendaten vorschlagen
                    if (e.target.checked && !signEmail.trim()) setSignEmail(ticket.customer_email ?? '')
                  }}
                />
                Ich möchte den Bericht per E-Mail erhalten
              </label>
              {wantsEmail && (
                <label>
                  E-Mail-Adresse *
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={signEmail}
                    maxLength={200}
                    onChange={(e) => setSignEmail(e.target.value)}
                    placeholder="name@beispiel.de"
                  />
                  {ticket.customer_email && signEmail.trim() === ticket.customer_email && (
                    <span className="small muted">Aus den Kundendaten übernommen, bei Bedarf ändern.</span>
                  )}
                </label>
              )}
              <div className="actions">
                <button disabled={busy} onClick={() => setSigning(false)}>Abbrechen</button>
                <button className="primary" disabled={busy || !hasInk || !signerName.trim() || (wantsEmail && !isEmail(signEmail))}
                  onClick={saveSignature}
                >
                  Unterschrift speichern
                </button>
              </div>
            </div>
          ) : canSign ? (
            <button
              className="primary"
              onClick={() => {
                setSigning(true)
                setSignerName(ticket.customer_name)
                setSignEmail(ticket.customer_email ?? '')
                setWantsEmail(false)
              }}
            >
              Kunde unterschreiben lassen
            </button>
          ) : (
            <p className="muted">Noch nicht unterschrieben.</p>
          )}
        </section>
      )}

      {canReport && (
        <section className="card">
          <div className="actions">
            <button
              className="primary"
              disabled={busy || signing || !report.trim() || openPositions > 0}
              onClick={() => {
                if (!ticket.signature_path && !confirm('Es gibt noch keine Kundenunterschrift. Trotzdem als erledigt melden?')) return
                closeJob()
              }}
            >
              Auftrag abschließen (Erledigt melden)
            </button>
          </div>
          {!report.trim() && <p className="muted small">Bitte zuerst den Arbeitsbericht ausfüllen.</p>}
          {openPositions > 0 && <p className="muted small">Noch {openPositions} Position(en) offen.</p>}
          {signing && <p className="muted small">Bitte zuerst die Unterschrift speichern.</p>}
        </section>
      )}

      {!einsatz && (
        <>
          <section className="card">
            <h2>Verantwortlicher Teamleiter</h2>
            {isAdmin && !closed ? (
              <select
                value={ticket.assigned_to ?? ''}
                disabled={busy}
                onChange={(e) => update({ assigned_to: e.target.value || null })}
              >
                <option value="">– nicht zugewiesen –</option>
                {leads.map((p) => (
                  <option key={p.id} value={p.id}>{displayName(p)}</option>
                ))}
              </select>
            ) : (
              <p>{ticket.assigned_to ? displayName(byId[ticket.assigned_to]) : <span className="muted">Noch nicht zugewiesen</span>}</p>
            )}
          </section>

          <section className="card">
            <h2>Ursache und Maßnahme</h2>
            {ticket.review_note && ticket.status === 'in_bearbeitung' && (
              <p className="info">Hinweis aus der Prüfung: {ticket.review_note}</p>
            )}
            {canWork ? (
              <div className="form">
                <label>
                  Ursache
                  <textarea rows={4} value={cause} onChange={(e) => setCause(e.target.value)} placeholder="Warum ist der Fehler entstanden?" />
                </label>
                <label>
                  Maßnahme gegen Wiederholung
                  <textarea rows={4} value={action} onChange={(e) => setAction(e.target.value)} placeholder="Was wurde getan, damit das nicht wieder passiert?" />
                </label>
                <div className="actions">
                  <button disabled={busy || !dirty} onClick={() => update({ cause, corrective_action: action })}>
                    Speichern
                  </button>
                  {ticket.status !== 'zur_pruefung' && (
                    <button
                      className="primary"
                      disabled={busy || !cause.trim() || !action.trim()}
                      onClick={() => update({ cause, corrective_action: action, status: 'zur_pruefung' })}
                    >
                      Erledigt – zur Prüfung
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <h3>Ursache</h3>
                {ticket.cause ? <p className="pre">{ticket.cause}</p> : <p className="muted">Noch nicht eingetragen.</p>}
                <h3>Maßnahme gegen Wiederholung</h3>
                {ticket.corrective_action ? <p className="pre">{ticket.corrective_action}</p> : <p className="muted">Noch nicht eingetragen.</p>}
              </>
            )}
          </section>

          {isAdmin && ticket.status === 'zur_pruefung' && (
            <section className="card highlight">
              <h2>Prüfung</h2>
              <p className="muted small">Ursache und Maßnahme prüfen und das Ticket abschließen oder mit Hinweis zurückgeben.</p>
              <label className="form">
                Hinweis an den Teamleiter (bei Rückgabe)
                <textarea rows={2} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
              </label>
              <div className="actions">
                <button
                  disabled={busy || !reviewNote.trim()}
                  onClick={async () => {
                    if (await update({ status: 'in_bearbeitung', review_note: reviewNote.trim() })) setReviewNote('')
                  }}
                >
                  Zurück an Teamleiter
                </button>
                <button className="primary" disabled={busy} onClick={() => update({ status: 'abgeschlossen' })}>
                  Abschließen
                </button>
              </div>
            </section>
          )}

        </>
      )}

      {error && <p className="error">{error}</p>}

      {ticket.ticket_type === 'beanstandung' && closed && isPlanner && <SelfCostCard ticket={ticket} byId={byId} onChanged={load} />}

      {profile.role !== 'monteur' && (
        <section className="card">
          <h2>Verlauf</h2>
          <ul className="history">
            {events.map((ev) => (
              <li key={ev.id}>
                <span className="muted small">{formatDate(ev.created_at)}</span>
                <span>
                  {EVENT_LABEL[ev.kind] ?? ev.kind}
                  {ev.kind === 'status' && <> „{statusLabel(ticket.ticket_type, ev.details as TicketStatus)}"</>}
                  {ev.kind === 'zugewiesen' && <> {ev.details || '–'}</>}
                  {(ev.kind === 'pruefhinweis' || ev.kind === 'loeschantrag') && <> {ev.details}</>}
                  {(ev.kind === 'auftrag' || ev.kind === 'eingeplant' || ev.kind === 'kw_vorgemerkt' || ev.kind.startsWith('termin_')) && <> {ev.details || '–'}</>}
                  {(ev.kind === 'berechnet' || ev.kind === 'selbstkosten' || ev.kind === 'position_ergaenzt') && <> {ev.details}</>}
                  {ev.kind === 'erstellt' && <> ({TYPE_LABEL[ticket.ticket_type]})</>}
                  {ev.kind === 'unterschrift' && <> {ev.details}</>}
                  {ev.kind === 'folgeauftrag' && <> <Link to={`/ticket/${ev.details}`}>{ticketNo(Number(ev.details), ticket.ticket_type)}</Link></>}
                  {ev.kind === 'aus_auftrag' && (
                    <>
                      {' '}<Link to={`/ticket/${ev.details.split(':')[0]}`}>{ticketNo(Number(ev.details.split(':')[0]), ticket.ticket_type)}</Link>
                      {' '}({ev.details.split(':')[1] ?? 0} {ev.details.split(':')[1] === '1' ? 'Position' : 'Positionen'} übernommen)
                    </>
                  )}
                  {ev.kind === 'bereich' && <> „{AREA_LABEL[ev.details as ServiceArea] ?? ev.details}"</>}
                  {ev.actor && <span className="muted"> · {displayName(byId[ev.actor])}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {deletion ? (
        <section className="card danger-card">
          <h2>Löschung beantragt</h2>
          <p className="muted small">
            von {displayName(byId[deletion.requested_by])} am {formatDate(deletion.created_at)}
          </p>
          <p className="pre">{deletion.reason}</p>
          <div className="actions">
            {isAdmin && (
              <>
                <button disabled={busy} onClick={dropDeletionRequest}>Ablehnen</button>
                <button className="danger" disabled={busy} onClick={removeTicket}>Löschung freigeben</button>
              </>
            )}
            {!isAdmin && deletion.requested_by === profile.id && (
              <button disabled={busy} onClick={dropDeletionRequest}>Antrag zurückziehen</button>
            )}
            {!isAdmin && deletion.requested_by !== profile.id && (
              <p className="muted small">Wartet auf Freigabe durch den Admin.</p>
            )}
          </div>
        </section>
      ) : isAdmin ? (
        <div className="actions danger-zone">
          <button className="danger" onClick={removeTicket}>Auftrag löschen</button>
          {closed && (
            <button className="push-right" disabled={busy} onClick={() => update({ status: einsatz ? 'zugewiesen' : 'in_bearbeitung' })}>
              Wieder öffnen
            </button>
          )}
        </div>
      ) : canRequestDeletion && requestingDeletion ? (
        <section className="card danger-card">
          <h2>Löschung beantragen</h2>
          <p className="muted small">Der Auftrag wird erst gelöscht, wenn der Admin den Antrag freigibt.</p>
          <label className="form">
            Begründung *
            <textarea rows={3} value={deletionReason} onChange={(e) => setDeletionReason(e.target.value)} placeholder="z. B. doppelt angelegt" />
          </label>
          <div className="actions">
            <button disabled={busy} onClick={() => setRequestingDeletion(false)}>Abbrechen</button>
            <button className="danger" disabled={busy || !deletionReason.trim()} onClick={requestDeletion}>Antrag stellen</button>
          </div>
        </section>
      ) : canRequestDeletion ? (
        <div className="actions danger-zone">
          <button className="danger" onClick={() => setRequestingDeletion(true)}>Löschung beantragen</button>
        </div>
      ) : null}
    </div>
  )
}
