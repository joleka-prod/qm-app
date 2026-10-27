import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { AddressSuggest } from '../components/AddressSuggest'
import { confirmAddresses } from '../lib/addressCheck'
import { StatusBadge, TypeBadge } from '../components/StatusBadge'
import { GROUP_LABEL, searchCustomers, type Customer, type CustomerContact, type CustomerNote } from '../lib/customers'
import { PROJECT_ROLES, ROLE_LABEL, projectAddress, roleForGroup, type Project, type ProjectCustomer, type ProjectRole } from '../lib/projects'
import { supabase } from '../lib/supabase'
import { TICKET_TYPES, TYPE_LABEL, formatDay, ticketNo, type Ticket } from '../lib/types'
import { useProfiles } from '../lib/useProfiles'
import { NotesCard } from './CustomerDetail'

type ProjectForm = Pick<Project, 'name' | 'street' | 'house_no' | 'zip' | 'city' | 'country' | 'status' | 'notes'>

const emptyForm: ProjectForm = { name: '', street: '', house_no: '', zip: '', city: '', country: 'Deutschland', status: 'aktiv', notes: '' }

type Participant = ProjectCustomer & { customers: Customer }

// Bauvorhaben-Akte: Stammdaten, Beteiligte, Aufträge, Kommunikation. /bauvorhaben/neu legt an.
export function ProjectDetail() {
  const { id } = useParams()
  const isNew = id === 'neu'
  const projectId = Number(id)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { profile } = useAuth()
  const { profiles, byId } = useProfiles()
  const [project, setProject] = useState<Project | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [contacts, setContacts] = useState<CustomerContact[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [notes, setNotes] = useState<CustomerNote[]>([])
  const [notFound, setNotFound] = useState(false)
  const [form, setForm] = useState<ProjectForm | null>(isNew ? { ...emptyForm } : null)
  const [fromCustomer, setFromCustomer] = useState<Customer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (isNew) return
    const [p, pc, t, n] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).maybeSingle(),
      supabase.from('project_customers').select('*, customers(*)').eq('project_id', projectId).order('id'),
      supabase.from('tickets').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
      supabase.from('customer_notes').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
    ])
    if (!p.data) return setNotFound(true)
    const parts = (pc.data ?? []) as Participant[]
    setProject(p.data as Project)
    setParticipants(parts)
    setTickets((t.data ?? []) as Ticket[])
    setNotes((n.data ?? []) as CustomerNote[])
    const ids = [...new Set(parts.map((x) => x.customer_id))]
    const { data: cc } = ids.length ? await supabase.from('customer_contacts').select('*').in('customer_id', ids).order('name') : { data: [] }
    setContacts((cc ?? []) as CustomerContact[])
  }, [isNew, projectId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!isNew) setForm(null)
  }, [isNew, id])

  // /bauvorhaben/neu?kunde=<id>: Kunde wird beteiligt; als Bauherr übernimmt das Bauvorhaben seine Adresse
  const kunde = params.get('kunde')
  useEffect(() => {
    if (!isNew || !kunde) return
    supabase
      .from('customers')
      .select('*')
      .eq('id', Number(kunde))
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        const c = data as Customer
        setFromCustomer(c)
        if (roleForGroup(c.customer_group) === 'bauherr') {
          setForm((f) => f && { ...f, name: `${c.name}, ${c.city}`.replace(/, $/, ''), street: c.street, house_no: c.house_no, zip: c.zip, city: c.city, country: c.country })
        }
      })
  }, [isNew, kunde])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    setBusy(true)
    setError('')
    // Adresse über die Navigation prüfen (bei Änderungen nur, wenn die Adresse geändert wurde)
    const addr = (p: ProjectForm) => ({ label: 'Adresse des Bauvorhabens', street: p.street, house_no: p.house_no, zip: p.zip, city: p.city, country: p.country })
    if (!(await confirmAddresses([addr(form)], !isNew && project ? [addr(project)] : []))) return setBusy(false)
    const row = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]))
    const res = isNew
      ? await supabase.from('projects').insert(row).select('id').single()
      : await supabase.from('projects').update(row).eq('id', projectId).select('id').single()
    if (res.error) {
      setBusy(false)
      return setError(res.error.message)
    }
    if (isNew && fromCustomer) {
      await supabase.from('project_customers').insert({ project_id: res.data.id, customer_id: fromCustomer.id, role: roleForGroup(fromCustomer.customer_group) })
    }
    setBusy(false)
    if (isNew) return navigate(`/bauvorhaben/${res.data.id}`, { replace: true })
    setForm(null)
    await load()
  }

  async function remove() {
    if (!confirm('Bauvorhaben endgültig löschen? Beteiligte werden entfernt, die Kunden bleiben erhalten.')) return
    const { error } = await supabase.from('projects').delete().eq('id', projectId)
    if (error) setError(/violates foreign key/.test(error.message) ? 'Das Bauvorhaben hat noch Aufträge und kann nicht gelöscht werden.' : error.message)
    else navigate('/bauvorhaben', { replace: true })
  }

  if (notFound) return <p>Bauvorhaben nicht gefunden. <Link to="/bauvorhaben">Zur Liste</Link></p>
  if (!profile || (!isNew && !project)) return <p className="muted">Lädt…</p>

  const set = (patch: Partial<ProjectForm>) => form && setForm({ ...form, ...patch })

  const editor = form && (
    <form className="card form" onSubmit={save}>
      <h2>{isNew ? 'Neues Bauvorhaben' : 'Bauvorhaben bearbeiten'}</h2>
      {isNew && fromCustomer && (
        <p className="small muted">
          Beteiligt: {fromCustomer.customer_number} {fromCustomer.name} als {ROLE_LABEL[roleForGroup(fromCustomer.customer_group)]}
        </p>
      )}
      <label>
        Bezeichnung *
        <input required maxLength={200} value={form.name} placeholder="z. B. Wohnpark Daun, Haus 3 oder Neubau Familie Müller" onChange={(e) => set({ name: e.target.value })} />
      </label>
      <ProjectAddressFields form={form} set={set} />
      {!isNew && (
        <label>
          Status
          <select value={form.status} onChange={(e) => set({ status: e.target.value as ProjectForm['status'] })}>
            <option value="aktiv">Aktiv</option>
            <option value="abgeschlossen">Abgeschlossen</option>
          </select>
        </label>
      )}
      <label>
        Bemerkung
        <textarea rows={3} maxLength={4000} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => (isNew ? navigate(-1) : setForm(null))}>Abbrechen</button>
        <button className="primary" disabled={busy}>{busy ? 'Speichert…' : 'Speichern'}</button>
      </div>
    </form>
  )

  if (isNew || !project) {
    return (
      <div className="detail">
        <Link to="/bauvorhaben" className="back">← Bauvorhaben</Link>
        {editor}
      </div>
    )
  }

  const address = projectAddress(project)
  const customers = [...new Map(participants.map((x) => [x.customer_id, x.customers])).values()]

  return (
    <div className="detail">
      <Link to="/bauvorhaben" className="back">← Bauvorhaben</Link>

      {form ? (
        editor
      ) : (
        <section className="card">
          <div className="ticket-row-top">
            <span className="ticket-no">{project.project_number}</span>
            <span className={`badge ${project.status === 'aktiv' ? 'badge-zugewiesen' : 'badge-abgeschlossen'}`}>
              {project.status === 'aktiv' ? 'Aktiv' : 'Abgeschlossen'}
            </span>
          </div>
          <h1 className="ticket-heading">{project.name}</h1>
          {address && (
            <p className="small">
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer">
                {address}
              </a>
            </p>
          )}
          {project.notes && <p className="pre small customer-notes">{project.notes}</p>}
          <div className="actions">
            <button
              onClick={() => {
                setError('')
                const { name, street, house_no, zip, city, country, status, notes } = project
                setForm({ name, street, house_no, zip, city, country, status, notes })
              }}
            >
              Bearbeiten
            </button>
          </div>
        </section>
      )}

      <ParticipantsCard projectId={project.id} participants={participants} onChanged={load} />

      <section className="card">
        <div className="card-head">
          <h2>Aufträge ({tickets.length})</h2>
          <Link className="button" to={`/neu?bv=${project.id}`}>+ Neuer Auftrag</Link>
        </div>
        {tickets.length === 0 ? (
          <p className="muted">Noch keine Aufträge.</p>
        ) : (
          TICKET_TYPES.filter((ty) => tickets.some((t) => t.ticket_type === ty)).map((ty) => (
            <div key={ty} className="project-group">
              <h3 className="project-name">{TYPE_LABEL[ty]}</h3>
              <ul className="history">
                {tickets
                  .filter((t) => t.ticket_type === ty)
                  .map((t) => (
                    <li key={t.id}>
                      <span className="customer-ticket">
                        <Link to={`/ticket/${t.id}`}>{ticketNo(t.id, t.ticket_type)}</Link> <TypeBadge type={t.ticket_type} />{' '}
                        <StatusBadge status={t.status} type={t.ticket_type} appointment={t.appointment_state} billing={t.billing_state} />
                      </span>
                      <span>{t.title}</span>
                      <span className="muted small">
                        {t.customer_name && `${t.customer_name} · `}Angelegt {formatDay(t.created_at.slice(0, 10))}
                        {t.montage_date && ` · Termin ${formatDay(t.montage_date)}`}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {customers.length > 0 ? (
        <NotesCard
          projectId={project.id}
          customers={customers}
          me={profile.id}
          notes={notes}
          contacts={contacts}
          tickets={tickets}
          profiles={profiles.filter((p) => p.active && p.role !== 'monteur')}
          byId={byId}
          isAdmin={profile.role === 'admin'}
          onChanged={load}
        />
      ) : (
        <section className="card">
          <h2>Kommunikation</h2>
          <p className="muted">Zuerst einen Beteiligten zuordnen, dann kann Kommunikation erfasst werden.</p>
        </section>
      )}

      {error && <p className="error">{error}</p>}
      {profile.role === 'admin' && tickets.length === 0 && (
        <div className="actions danger-zone">
          <button className="danger" onClick={remove}>Bauvorhaben löschen</button>
        </div>
      )}
    </div>
  )
}

function ProjectAddressFields({ form, set }: { form: ProjectForm; set: (p: Partial<ProjectForm>) => void }) {
  const [typing, setTyping] = useState(false)
  return (
    <>
      <div className="row street-row">
        <label>
          Straße
          <input
            autoComplete="off"
            maxLength={150}
            value={form.street}
            onChange={(e) => {
              setTyping(true)
              set({ street: e.target.value })
            }}
            onBlur={() => setTyping(false)}
          />
        </label>
        <label>
          Nr.
          <input maxLength={20} value={form.house_no} onChange={(e) => set({ house_no: e.target.value })} />
        </label>
      </div>
      <AddressSuggest
        active={typing}
        query={`${form.street} ${form.house_no} ${form.zip} ${form.city}`}
        onPick={(a) => {
          setTyping(false)
          set({ street: a.street, house_no: a.house_no || form.house_no, zip: a.zip, city: a.city, country: a.country || form.country })
        }}
      />
      <div className="row zip-row">
        <label>
          PLZ
          <input inputMode="numeric" maxLength={10} value={form.zip} onChange={(e) => set({ zip: e.target.value })} />
        </label>
        <label>
          Ort
          <input maxLength={100} value={form.city} onChange={(e) => set({ city: e.target.value })} />
        </label>
      </div>
    </>
  )
}

// --- Beteiligte Kunden ---

function ParticipantsCard({ projectId, participants, onChanged }: { projectId: number; participants: Participant[]; onChanged: () => Promise<void> }) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Customer[]>([])
  const [picked, setPicked] = useState<Customer | null>(null)
  const [role, setRole] = useState<ProjectRole>('bauherr')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (picked || query.trim().length < 2) {
      setMatches([])
      return
    }
    let stale = false
    const t = setTimeout(async () => {
      const found = await searchCustomers(query)
      if (!stale) setMatches(found)
    }, 250)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [query, picked])

  function reset() {
    setAdding(false)
    setQuery('')
    setPicked(null)
    setRole('bauherr')
    setNote('')
    setError('')
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!picked) return
    setBusy(true)
    setError('')
    const { error } = await supabase.from('project_customers').insert({ project_id: projectId, customer_id: picked.id, role, note: note.trim() })
    setBusy(false)
    if (error) return setError(/project_customers_unique/.test(error.message) ? 'Der Kunde ist in dieser Rolle schon beteiligt.' : error.message)
    reset()
    await onChanged()
  }

  async function remove(p: Participant) {
    if (!confirm(`„${p.customers.name}“ (${ROLE_LABEL[p.role]}) vom Bauvorhaben entfernen?`)) return
    await supabase.from('project_customers').delete().eq('id', p.id)
    await onChanged()
  }

  const sorted = [...participants].sort((a, b) => PROJECT_ROLES.indexOf(a.role) - PROJECT_ROLES.indexOf(b.role))

  return (
    <section className="card">
      <div className="card-head">
        <h2>Beteiligte</h2>
        {!adding && <button onClick={() => setAdding(true)}>+ Beteiligten zuordnen</button>}
      </div>
      {adding && (
        <form className="form note-form" onSubmit={add}>
          {picked ? (
            <p className="customer-summary">
              <span>
                <strong>{picked.customer_number} {picked.name}</strong>
                <span className="muted small"> · {GROUP_LABEL[picked.customer_group]}</span>
              </span>
              <button type="button" className="link" onClick={() => setPicked(null)}>anderer Kunde</button>
            </p>
          ) : (
            <label>
              Kunde *
              <input autoFocus autoComplete="off" value={query} placeholder="Name oder Kundennummer eintippen" onChange={(e) => setQuery(e.target.value)} />
            </label>
          )}
          {matches.length > 0 && !picked && (
            <ul className="address-suggest" role="listbox" aria-label="Kunden">
              {matches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(c)
                      setRole(roleForGroup(c.customer_group))
                    }}
                  >
                    <strong>{c.customer_number}</strong> {c.name}
                    <span className="muted small"> · {GROUP_LABEL[c.customer_group]}{c.city && ` · ${c.zip} ${c.city}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!picked && query.trim().length >= 2 && matches.length === 0 && (
            <p className="small muted">
              Kein Kunde gefunden. <Link to="/kunden/neu">Neuen Kunden anlegen</Link> und danach hier zuordnen.
            </p>
          )}
          <div className="row">
            <label>
              Rolle
              <select value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
                {PROJECT_ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </label>
            <label>
              Bemerkung
              <input maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Wohnung 2 OG links" />
            </label>
          </div>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="button" disabled={busy} onClick={reset}>Abbrechen</button>
            <button className="primary" disabled={busy || !picked}>Zuordnen</button>
          </div>
        </form>
      )}
      {participants.length === 0 && !adding ? (
        <p className="muted">Noch keine Beteiligten.</p>
      ) : (
        <ul className="history">
          {sorted.map((p) => (
            <li key={p.id} className="contact-row">
              <div>
                <span className="muted small">{ROLE_LABEL[p.role]}</span>
                <div>
                  <Link to={`/kunden/${p.customer_id}`}>
                    {p.customers.customer_number} {p.customers.name}
                  </Link>
                  {p.customers.city && <span className="muted small"> · {p.customers.zip} {p.customers.city}</span>}
                </div>
                {(p.customers.phone || p.customers.mobile) && (
                  <div className="small">
                    {[p.customers.phone, p.customers.mobile].filter(Boolean).map((tel) => (
                      <a key={tel} href={`tel:${tel.replace(/[^\d+]/g, '')}`} className="tel-link">
                        {tel}
                      </a>
                    ))}
                  </div>
                )}
                {p.note && <div className="small muted">{p.note}</div>}
              </div>
              <button className="link danger-link" onClick={() => remove(p)}>entfernen</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
