import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { AddressSuggest } from '../components/AddressSuggest'
import { EndCustomersCard } from '../components/EndCustomersCard'
import { StatusBadge, TypeBadge } from '../components/StatusBadge'
import {
  CUSTOMER_GROUPS,
  GROUP_LABEL,
  NOTE_KINDS,
  NOTE_KIND_LABEL,
  customerAddress,
  type Customer,
  type CustomerContact,
  type CustomerGroup,
  type CustomerNote,
  type NoteKind,
} from '../lib/customers'
import { supabase } from '../lib/supabase'
import { displayName, formatDate, formatDay, isEmail, isoDate, ticketNo, type Ticket } from '../lib/types'
import { useProfiles } from '../lib/useProfiles'
import { GroupBadge } from './Customers'

type CustomerForm = Pick<
  Customer,
  'customer_number' | 'customer_group' | 'name' | 'name2' | 'street' | 'house_no' | 'zip' | 'city' | 'country' | 'phone' | 'mobile' | 'email' | 'website' | 'notes' | 'active'
>

const emptyForm: CustomerForm = {
  customer_number: '',
  customer_group: 'privat',
  name: '',
  name2: '',
  street: '',
  house_no: '',
  zip: '',
  city: '',
  country: 'Deutschland',
  phone: '',
  mobile: '',
  email: '',
  website: '',
  notes: '',
  active: true,
}

const NAME_LABEL: Record<CustomerGroup, [string, string]> = {
  privat: ['Name *', 'z. B. Familie Müller'],
  bautraeger: ['Firma *', 'z. B. Eifel Bau GmbH'],
  generalunternehmer: ['Firma *', 'z. B. Mosel Hochbau GmbH'],
  architekt: ['Büro / Name *', 'z. B. Architekturbüro Schmitz'],
  oeffentlich: ['Behörde / Einrichtung *', 'z. B. Verbandsgemeinde Gerolstein'],
}

function formOf(c: Customer): CustomerForm {
  const { customer_number, customer_group, name, name2, street, house_no, zip, city, country, phone, mobile, email, website, notes, active } = c
  return { customer_number, customer_group, name, name2, street, house_no, zip, city, country, phone, mobile, email, website, notes, active }
}

// Kundenakte: Stammdaten, Ansprechpartner, Kommunikationsverlauf, Aufträge. /kunden/neu legt an.
export function CustomerDetail() {
  const { id } = useParams()
  const isNew = id === 'neu'
  const customerId = Number(id)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { profile } = useAuth()
  const { profiles, byId } = useProfiles()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [contacts, setContacts] = useState<CustomerContact[]>([])
  const [notes, setNotes] = useState<CustomerNote[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [notFound, setNotFound] = useState(false)
  const newForm = () => ({ ...emptyForm, customer_group: CUSTOMER_GROUPS.find((g) => g === params.get('gruppe')) ?? 'privat' })
  const [form, setForm] = useState<CustomerForm | null>(isNew ? newForm : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (isNew) return
    const [c, p, n, t] = await Promise.all([
      supabase.from('customers').select('*').eq('id', customerId).maybeSingle(),
      supabase.from('customer_contacts').select('*').eq('customer_id', customerId).order('name'),
      supabase.from('customer_notes').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }),
      supabase.from('tickets').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }),
    ])
    if (!c.data) return setNotFound(true)
    setCustomer(c.data as Customer)
    setContacts((p.data ?? []) as CustomerContact[])
    setNotes((n.data ?? []) as CustomerNote[])
    setTickets((t.data ?? []) as Ticket[])
  }, [isNew, customerId])

  useEffect(() => {
    load()
  }, [load])

  // Nach dem Anlegen (/kunden/neu → /kunden/<id>) die Akte zeigen, nicht das Formular
  useEffect(() => {
    setForm(isNew ? newForm() : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, id])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    if (form.email.trim() && !isEmail(form.email)) return setError('Bitte eine gültige E-Mail-Adresse eingeben.')
    setBusy(true)
    setError('')
    const row = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]))
    const res = isNew
      ? await supabase.from('customers').insert(row).select('id').single()
      : await supabase.from('customers').update(row).eq('id', customerId).select('id').single()
    setBusy(false)
    if (res.error) {
      return setError(/customers_number_unique/.test(res.error.message) ? 'Diese Kundennummer gibt es schon.' : res.error.message)
    }
    if (isNew) return navigate(`/kunden/${res.data.id}`, { replace: true })
    setForm(null)
    await load()
  }

  async function remove() {
    if (!customer) return
    const msg =
      tickets.length > 0
        ? `Kunde endgültig löschen? Die ${tickets.length} Aufträge bleiben erhalten, verlieren aber die Verknüpfung. Ansprechpartner und Kommunikation werden gelöscht.\n\nTipp: Stattdessen „nicht mehr aktiv“ setzen.`
        : 'Kunde mit Ansprechpartnern und Kommunikation endgültig löschen?'
    if (!confirm(msg)) return
    const { error } = await supabase.from('customers').delete().eq('id', customer.id)
    if (error) setError(error.message)
    else navigate('/kunden', { replace: true })
  }

  if (notFound) return <p>Kunde nicht gefunden. <Link to="/kunden">Zur Kundenliste</Link></p>
  if (!profile || (!isNew && !customer)) return <p className="muted">Lädt…</p>

  const set = (patch: Partial<CustomerForm>) => form && setForm({ ...form, ...patch })

  const editor = form && (
    <form className="card form" onSubmit={save}>
      <h2>{isNew ? 'Neuer Kunde' : 'Stammdaten bearbeiten'}</h2>
      <div className="field">
        <span>Kundengruppe</span>
        <select value={form.customer_group} onChange={(e) => set({ customer_group: e.target.value as CustomerGroup })}>
          {CUSTOMER_GROUPS.map((g) => (
            <option key={g} value={g}>{GROUP_LABEL[g]}</option>
          ))}
        </select>
      </div>
      <label>
        Kundennummer
        <input
          value={form.customer_number}
          maxLength={30}
          placeholder={isNew ? 'wird automatisch vergeben' : ''}
          onChange={(e) => set({ customer_number: e.target.value })}
        />
      </label>
      <label>
        {NAME_LABEL[form.customer_group][0]}
        <input required maxLength={150} value={form.name} placeholder={NAME_LABEL[form.customer_group][1]} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label>
        Zusatz
        <input maxLength={150} value={form.name2} placeholder="z. B. Abteilung, z. Hd., Bauabschnitt" onChange={(e) => set({ name2: e.target.value })} />
      </label>
      <CustomerAddress form={form} set={set} />
      <div className="row">
        <label>
          Telefon
          <input type="tel" maxLength={50} value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
        </label>
        <label>
          Mobil
          <input type="tel" maxLength={50} value={form.mobile} onChange={(e) => set({ mobile: e.target.value })} />
        </label>
      </div>
      <div className="row">
        <label>
          E-Mail
          <input type="email" inputMode="email" maxLength={200} value={form.email} onChange={(e) => set({ email: e.target.value })} />
        </label>
        <label>
          Webseite
          <input maxLength={200} value={form.website} onChange={(e) => set({ website: e.target.value })} />
        </label>
      </div>
      <label>
        Bemerkung
        <textarea rows={3} maxLength={4000} value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Dauerhafte Hinweise, z. B. Zahlungsweise, Zufahrt, Besonderheiten" />
      </label>
      {!isNew && (
        <label className="checkbox-row">
          <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
          Aktiv (bei Aufträgen auswählbar)
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => (isNew ? navigate(-1) : setForm(null))}>Abbrechen</button>
        <button className="primary" disabled={busy}>{busy ? 'Speichert…' : 'Speichern'}</button>
      </div>
    </form>
  )

  if (isNew || !customer) {
    return (
      <div className="detail">
        <Link to="/kunden" className="back">← Kunden</Link>
        {editor}
      </div>
    )
  }

  const address = customerAddress(customer)

  return (
    <div className="detail">
      <Link to="/kunden" className="back">← Kunden</Link>

      {form ? (
        editor
      ) : (
        <section className="card">
          <div className="ticket-row-top">
            <span className="ticket-no">{customer.customer_number}</span>
            <GroupBadge group={customer.customer_group} />
          </div>
          <h1 className="ticket-heading">{customer.name}</h1>
          {customer.name2 && <p className="muted customer-name2">{customer.name2}</p>}
          {!customer.active && <p className="small error">Nicht mehr aktiv</p>}
          {address && (
            <p className="small">
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer">
                {address}
              </a>
            </p>
          )}
          <ContactLine phone={customer.phone} mobile={customer.mobile} email={customer.email} website={customer.website} />
          {customer.notes && <p className="pre small customer-notes">{customer.notes}</p>}
          <div className="actions">
            <button onClick={() => { setError(''); setForm(formOf(customer)) }}>Bearbeiten</button>
          </div>
        </section>
      )}

      <ContactsCard customerId={customer.id} contacts={contacts} onChanged={load} />

      <EndCustomersCard key={customer.id} customer={customer} tickets={tickets} />

      <NotesCard
        customerId={customer.id}
        me={profile.id}
        notes={notes}
        contacts={contacts}
        tickets={tickets}
        profiles={profiles.filter((p) => p.active && p.role !== 'monteur')}
        byId={byId}
        isAdmin={profile.role === 'admin'}
        onChanged={load}
      />

      <section className="card">
        <div className="card-head">
          <h2>Aufträge ({tickets.length})</h2>
          <Link className="button" to={`/neu?kunde=${customer.id}`}>+ Neuer Auftrag</Link>
        </div>
        {tickets.length === 0 ? (
          <p className="muted">Noch keine Aufträge.</p>
        ) : (
          <ul className="history">
            {tickets.map((t) => (
              <li key={t.id}>
                <span className="customer-ticket">
                  <Link to={`/ticket/${t.id}`}>{ticketNo(t.id, t.ticket_type)}</Link> <TypeBadge type={t.ticket_type} />{' '}
                  <StatusBadge status={t.status} type={t.ticket_type} appointment={t.appointment_state} billing={t.billing_state} />
                </span>
                <span>{t.title}</span>
                <span className="muted small">
                  Angelegt {formatDay(t.created_at.slice(0, 10))}
                  {t.montage_date && ` · Termin ${formatDay(t.montage_date)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && <p className="error">{error}</p>}
      {profile.role === 'admin' && (
        <div className="actions danger-zone">
          <button className="danger" onClick={remove}>Kunde löschen</button>
        </div>
      )}
    </div>
  )
}

function CustomerAddress({ form, set }: { form: CustomerForm; set: (p: Partial<CustomerForm>) => void }) {
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
          Hausnummer
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
      <label>
        Land
        <input list="country-list" maxLength={60} value={form.country} onChange={(e) => set({ country: e.target.value })} />
      </label>
    </>
  )
}

function ContactLine({ phone, mobile, email, website }: { phone: string; mobile: string; email: string; website?: string }) {
  const parts = [
    phone && <a key="t" href={`tel:${phone.replace(/[^\d+]/g, '')}`}>☎ {phone}</a>,
    mobile && <a key="m" href={`tel:${mobile.replace(/[^\d+]/g, '')}`}>📱 {mobile}</a>,
    email && <a key="e" href={`mailto:${email}`}>{email}</a>,
    website && (
      <a key="w" href={/^https?:\/\//.test(website) ? website : `https://${website}`} target="_blank" rel="noreferrer">
        {website}
      </a>
    ),
  ].filter(Boolean)
  if (parts.length === 0) return null
  return <p className="small contact-line">{parts}</p>
}

// --- Ansprechpartner ---

type ContactForm = { id?: number; name: string; position: string; phone: string; mobile: string; email: string; notes: string }
const emptyContact: ContactForm = { name: '', position: '', phone: '', mobile: '', email: '', notes: '' }

function ContactsCard({ customerId, contacts, onChanged }: { customerId: number; contacts: CustomerContact[]; onChanged: () => Promise<void> }) {
  const [form, setForm] = useState<ContactForm | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    if (form.email.trim() && !isEmail(form.email)) return setError('Bitte eine gültige E-Mail-Adresse eingeben.')
    setBusy(true)
    setError('')
    const { id, ...rest } = form
    const row = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v.trim()]))
    const { error } = id
      ? await supabase.from('customer_contacts').update(row).eq('id', id)
      : await supabase.from('customer_contacts').insert({ ...row, customer_id: customerId })
    if (error) setError(error.message)
    else setForm(null)
    await onChanged()
    setBusy(false)
  }

  async function remove(c: CustomerContact) {
    if (!confirm(`Ansprechpartner „${c.name}“ entfernen? Einträge in der Kommunikation bleiben erhalten.`)) return
    await supabase.from('customer_contacts').delete().eq('id', c.id)
    setForm(null)
    await onChanged()
  }

  const set = (patch: Partial<ContactForm>) => form && setForm({ ...form, ...patch })
  const editor = form && (
    <form className="form contact-form" onSubmit={save}>
      <div className="row">
        <label>
          Name *
          <input required autoFocus maxLength={150} value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label>
          Funktion
          <input maxLength={100} value={form.position} placeholder="z. B. Bauleiter, Einkauf" onChange={(e) => set({ position: e.target.value })} />
        </label>
      </div>
      <div className="row">
        <label>
          Telefon
          <input type="tel" maxLength={50} value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
        </label>
        <label>
          Mobil
          <input type="tel" maxLength={50} value={form.mobile} onChange={(e) => set({ mobile: e.target.value })} />
        </label>
      </div>
      <label>
        E-Mail
        <input type="email" inputMode="email" maxLength={200} value={form.email} onChange={(e) => set({ email: e.target.value })} />
      </label>
      <label>
        Bemerkung
        <input maxLength={1000} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        {form.id && (
          <button type="button" className="link danger-link" disabled={busy} onClick={() => remove(contacts.find((c) => c.id === form.id)!)}>
            Entfernen
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => setForm(null)}>Abbrechen</button>
        <button className="primary" disabled={busy}>Speichern</button>
      </div>
    </form>
  )

  return (
    <section className="card">
      <div className="card-head">
        <h2>Ansprechpartner</h2>
        {!form && <button onClick={() => { setError(''); setForm({ ...emptyContact }) }}>+ Ansprechpartner</button>}
      </div>
      {form && !form.id && editor}
      {contacts.length === 0 && !form ? (
        <p className="muted">Noch keine Ansprechpartner.</p>
      ) : (
        <ul className="history">
          {contacts.map((c) =>
            form?.id === c.id ? (
              <li key={c.id}>{editor}</li>
            ) : (
              <li key={c.id} className="contact-row">
                <div>
                  <strong>{c.name}</strong>
                  {c.position && <span className="muted"> · {c.position}</span>}
                  <ContactLine phone={c.phone} mobile={c.mobile} email={c.email} />
                  {c.notes && <div className="small muted">{c.notes}</div>}
                </div>
                <button className="link" onClick={() => { setError(''); setForm({ ...c }) }}>Bearbeiten</button>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  )
}

// --- Kommunikation ---

interface NotesProps {
  customerId: number
  me: string
  notes: CustomerNote[]
  contacts: CustomerContact[]
  tickets: Ticket[]
  profiles: { id: string; full_name: string; email: string }[]
  byId: Record<string, { full_name: string; email: string }>
  isAdmin: boolean
  onChanged: () => Promise<void>
}

function NotesCard({ customerId, me, notes, contacts, tickets, profiles, byId, isAdmin, onChanged }: NotesProps) {
  const [kind, setKind] = useState<NoteKind>('telefon')
  const [contactId, setContactId] = useState('')
  const [ticketId, setTicketId] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [followUser, setFollowUser] = useState(me)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [kindFilter, setKindFilter] = useState<NoteKind | ''>('')

  function reset() {
    setKind('telefon')
    setContactId('')
    setTicketId('')
    setSubject('')
    setBody('')
    setFollowUp('')
    setFollowUser(me)
    setOpen(false)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.from('customer_notes').insert({
      customer_id: customerId,
      kind,
      contact_id: contactId ? Number(contactId) : null,
      ticket_id: ticketId ? Number(ticketId) : null,
      subject: subject.trim(),
      body: body.trim(),
      follow_up_date: followUp || null,
      follow_up_user: followUp ? followUser : null,
    })
    if (error) setError(error.message)
    else reset()
    await onChanged()
    setBusy(false)
  }

  async function toggleDone(n: CustomerNote) {
    setBusy(true)
    await supabase
      .from('customer_notes')
      .update({ follow_up_done_at: n.follow_up_done_at ? null : new Date().toISOString() })
      .eq('id', n.id)
    await onChanged()
    setBusy(false)
  }

  async function remove(n: CustomerNote) {
    if (!confirm('Eintrag endgültig aus dem Verlauf löschen?')) return
    await supabase.from('customer_notes').delete().eq('id', n.id)
    await onChanged()
  }

  const contactById = Object.fromEntries(contacts.map((c) => [c.id, c]))
  const today = isoDate(new Date())
  const visible = notes.filter((n) => !kindFilter || n.kind === kindFilter)

  return (
    <section className="card">
      <div className="card-head">
        <h2>Kommunikation</h2>
        {!open && <button className="primary" onClick={() => setOpen(true)}>+ Eintrag</button>}
      </div>
      {open && (
        <form className="form note-form" onSubmit={save}>
          <div className="chip-row" role="radiogroup" aria-label="Art">
            {NOTE_KINDS.map((k) => (
              <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'chip active' : 'chip'} onClick={() => setKind(k)}>
                {NOTE_KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="row">
            <label>
              Ansprechpartner
              <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">–</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.position && ` (${c.position})`}</option>
                ))}
              </select>
            </label>
            <label>
              Zum Auftrag
              <select value={ticketId} onChange={(e) => setTicketId(e.target.value)}>
                <option value="">–</option>
                {tickets.map((t) => (
                  <option key={t.id} value={t.id}>{ticketNo(t.id, t.ticket_type)} {t.title}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Betreff
            <input maxLength={200} value={subject} autoFocus onChange={(e) => setSubject(e.target.value)} placeholder="z. B. Angebot nachgefragt" />
          </label>
          <label>
            Inhalt
            <textarea rows={4} maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Was wurde besprochen / vereinbart?" />
          </label>
          <div className="row">
            <label>
              Wiedervorlage am
              <input type="date" min={today} value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
            </label>
            {followUp && (
              <label>
                Wiedervorlage für
                <select value={followUser} onChange={(e) => setFollowUser(e.target.value)}>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{displayName(p)}{p.id === me ? ' (ich)' : ''}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="muted small">Einträge bleiben im Verlauf für alle sichtbar und können später nicht mehr geändert werden.</p>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="button" disabled={busy} onClick={reset}>Abbrechen</button>
            <button className="primary" disabled={busy || (!subject.trim() && !body.trim())}>Eintrag speichern</button>
          </div>
        </form>
      )}

      {notes.length > 0 && (
        <div className="filters note-filter">
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as NoteKind | '')} aria-label="Art filtern">
            <option value="">Alle Einträge ({notes.length})</option>
            {NOTE_KINDS.map((k) => (
              <option key={k} value={k}>{NOTE_KIND_LABEL[k]} ({notes.filter((n) => n.kind === k).length})</option>
            ))}
          </select>
        </div>
      )}

      {notes.length === 0 && !open ? (
        <p className="muted">Noch keine Kommunikation erfasst.</p>
      ) : (
        <ul className="note-list">
          {visible.map((n) => {
            const contact = n.contact_id ? contactById[n.contact_id] : null
            const ticket = n.ticket_id ? tickets.find((t) => t.id === n.ticket_id) : null
            return (
              <li key={n.id} className={`note note-${n.kind}`}>
                <div className="note-head">
                  <span className="note-kind">{NOTE_KIND_LABEL[n.kind]}</span>
                  <span className="muted small">
                    {formatDate(n.created_at)} · {n.created_by ? displayName(byId[n.created_by]) : '–'}
                  </span>
                </div>
                {(contact || ticket) && (
                  <div className="small muted">
                    {contact && <>mit {contact.name}</>}
                    {contact && ticket && ' · '}
                    {ticket && <Link to={`/ticket/${ticket.id}`}>{ticketNo(ticket.id, ticket.ticket_type)} {ticket.title}</Link>}
                  </div>
                )}
                {n.subject && <div className="note-subject">{n.subject}</div>}
                {n.body && <p className="pre">{n.body}</p>}
                {n.follow_up_date && (
                  <div className="note-follow small">
                    {n.follow_up_done_at ? (
                      <span className="muted">
                        ✓ Wiedervorlage {formatDay(n.follow_up_date)} erledigt
                        {n.follow_up_done_by && ` von ${displayName(byId[n.follow_up_done_by])}`}
                      </span>
                    ) : (
                      <span className={n.follow_up_date <= today ? 'follow-up-due' : ''}>
                        Wiedervorlage {formatDay(n.follow_up_date)}
                        {n.follow_up_user && ` für ${displayName(byId[n.follow_up_user])}`}
                      </span>
                    )}{' '}
                    <button className="link" disabled={busy} onClick={() => toggleDone(n)}>
                      {n.follow_up_done_at ? 'wieder öffnen' : 'erledigt'}
                    </button>
                  </div>
                )}
                {isAdmin && (
                  <button className="link danger-link small" onClick={() => remove(n)}>Löschen</button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
