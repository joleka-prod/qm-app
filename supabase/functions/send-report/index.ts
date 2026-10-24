// Schickt dem Kunden nach Abschluss eines Einsatzes den Servicebericht als PDF per E-Mail (über Resend).
// Wird von der App nach "Erledigt melden" aufgerufen. Benötigte Secrets: RESEND_API_KEY, MAIL_FROM.
// Optional: MAIL_REPLY_TO, COMPANY_NAME, LOGO_URL (Logo oben rechts, Standard: logo.jpg der App), RESEND_API_URL (nur für Tests).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1'
import { encodeBase64 } from 'jsr:@std/encoding@1/base64'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const TYPE_LABEL: Record<string, string> = {
  restarbeit: 'Restarbeit',
  beanstandung: 'Beanstandung',
  reparatur: 'Reparaturauftrag',
}
const TYPE_PREFIX: Record<string, string> = { restarbeit: 'RA', beanstandung: 'BE', reparatur: 'RP' }
const MAX_PHOTOS = 20

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function fmtDate(iso: string | null, withTime = true) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit', month: '2-digit', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

// Standardschrift kann nur WinAnsi (deckt Umlaute ab); alles andere wird ersetzt.
function clean(s: string) {
  return s.replace(/\r/g, '').replace(/[^\n\x20-\x7E\xA0-\xFF€–—„“”‚‘’…•]/g, '?')
}

class Writer {
  page!: PDFPage
  y = 0
  readonly margin = 50
  // Platz rechts oben für das Logo: bis zu dieser Höhe werden Zeilen schmaler umbrochen
  reserveW = 0
  reserveUntil = 842
  constructor(private doc: PDFDocument, private font: PDFFont, private bold: PDFFont) {
    this.newPage()
  }
  get width() {
    return 595 - 2 * this.margin
  }
  newPage() {
    this.page = this.doc.addPage([595, 842])
    this.y = 842 - this.margin
  }
  need(h: number) {
    if (this.y - h < this.margin) this.newPage()
  }
  lines(text: string, size: number, font: PDFFont, width: number) {
    const out: string[] = []
    for (const para of clean(text).split('\n')) {
      let line = ''
      for (const word of para.split(' ')) {
        const next = line ? `${line} ${word}` : word
        if (font.widthOfTextAtSize(next, size) > width && line) {
          out.push(line)
          line = word
        } else line = next
      }
      out.push(line)
    }
    return out
  }
  text(text: string, opts: { size?: number; bold?: boolean; indent?: number; color?: [number, number, number]; gap?: number } = {}) {
    const size = opts.size ?? 10
    const font = opts.bold ? this.bold : this.font
    const indent = opts.indent ?? 0
    const reserve = this.y > this.reserveUntil ? this.reserveW : 0
    for (const line of this.lines(text, size, font, this.width - indent - reserve)) {
      this.need(size * 1.4)
      this.page.drawText(line, {
        x: this.margin + indent, y: this.y - size, size, font,
        color: opts.color ? rgb(...opts.color) : rgb(0.07, 0.09, 0.15),
      })
      this.y -= size * 1.4
    }
    this.y -= opts.gap ?? 2
  }
  heading(text: string) {
    this.y -= 8
    this.need(40)
    this.text(text, { size: 13, bold: true, gap: 4 })
  }
  rule() {
    this.need(10)
    this.page.drawLine({
      start: { x: this.margin, y: this.y }, end: { x: 595 - this.margin, y: this.y },
      thickness: 0.5, color: rgb(0.8, 0.82, 0.86),
    })
    this.y -= 8
  }
  async image(bytes: Uint8Array, png: boolean, maxW: number, maxH: number, indent = 0) {
    const img = png ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes)
    const scale = Math.min(maxW / img.width, maxH / img.height, 1)
    const w = img.width * scale
    const h = img.height * scale
    this.need(h + 6)
    this.page.drawImage(img, { x: this.margin + indent, y: this.y - h, width: w, height: h })
    this.y -= h + 6
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'Nur POST erlaubt' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
  const { data: caller } = await admin.auth.getUser(token)
  if (!caller.user) return reply(401, { error: 'Nicht angemeldet' })
  const { data: me } = await admin.from('profiles').select('role, active').eq('id', caller.user.id).single()
  if (!me?.active) return reply(403, { error: 'Kein Zugriff' })

  let body: { ticket_id?: number; force?: boolean }
  try {
    body = await req.json()
  } catch {
    return reply(400, { error: 'Ungültige Anfrage' })
  }

  const { data: t } = await admin.from('tickets').select('*').eq('id', body.ticket_id ?? 0).maybeSingle()
  if (!t || t.ticket_type === 'qm') return reply(404, { error: 'Auftrag nicht gefunden' })
  const planner = me.role === 'admin' || me.role === 'teamleiter'
  const { data: crew } = await admin
    .from('team_members')
    .select('installer_id, lead')
    .eq('team_id', t.team_id ?? 0)
    .eq('day', t.montage_date ?? '1900-01-01')
  const crewIds = (crew ?? []).map((m) => m.installer_id as string)
  const leadId = (crew ?? []).find((m) => m.lead)?.installer_id as string | undefined
  if (!planner && !crewIds.includes(caller.user.id)) return reply(403, { error: 'Kein Zugriff' })
  if (t.status !== 'abgeschlossen') return reply(400, { error: 'Der Auftrag ist noch nicht erledigt.' })
  if (!t.report_by_email || !t.customer_email) return reply(400, { error: 'Der Kunde hat keinen Bericht per E-Mail gewünscht.' })
  if (t.report_sent_at && !(body.force && planner)) return reply(200, { already: true, sent_at: t.report_sent_at })

  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('MAIL_FROM')
  const company = Deno.env.get('COMPANY_NAME') ?? 'JOLEKA'
  const fail = async (msg: string) => {
    await admin.from('tickets').update({ report_send_error: msg }).eq('id', t.id)
    return reply(502, { error: msg })
  }
  if (!apiKey || !from) return fail('E-Mail-Versand ist noch nicht eingerichtet (RESEND_API_KEY / MAIL_FROM fehlen).')

  const [{ data: positions }, { data: photos }, { data: profiles }, { data: team }, { data: times }] = await Promise.all([
    admin.from('ticket_positions').select('*').eq('ticket_id', t.id).order('sort').order('id'),
    admin.from('ticket_photos').select('*').eq('ticket_id', t.id).order('created_at'),
    admin.from('profiles').select('id, full_name, email'),
    admin.from('teams').select('name').eq('id', t.team_id ?? 0).maybeSingle(),
    admin.from('time_entries').select('installer_id, started_at, ended_at').eq('ticket_id', t.id).order('started_at'),
  ])
  const name = (id: string | null) => {
    const p = profiles?.find((x) => x.id === id)
    return p ? p.full_name || p.email : ''
  }
  const no = `${TYPE_PREFIX[t.ticket_type]}-${String(t.id).padStart(4, '0')}`

  // ---------------------------------------------------------------- PDF
  const doc = await PDFDocument.create()
  doc.setTitle(`Servicebericht ${no}`)
  doc.setAuthor(company)
  const w = new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold))
  const grey: [number, number, number] = [0.4, 0.44, 0.5]

  // Firmenlogo oben rechts (PNG oder JPG); fehlt es, bleibt der Platz frei
  const logoUrl = Deno.env.get('LOGO_URL') ?? 'https://qm-app.fabian-rieder.workers.dev/logo.jpg'
  try {
    const res = await fetch(logoUrl)
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer())
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50
      const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
      const scale = Math.min(160 / img.width, 60 / img.height)
      const lw = img.width * scale
      const lh = img.height * scale
      w.page.drawImage(img, { x: 595 - w.margin - lw, y: 842 - w.margin - lh, width: lw, height: lh })
      w.reserveW = lw + 12
      w.reserveUntil = 842 - w.margin - lh - 4
    }
  } catch {
    // ohne Logo weiter
  }

  // Firmenname nur ohne Logo
  if (!w.reserveW) w.text(company, { size: 11, bold: true, color: grey })
  w.text(`Servicebericht ${no}`, { size: 20, bold: true, gap: 6 })
  w.text(`${TYPE_LABEL[t.ticket_type]}: ${t.title}`, { size: 12, bold: true, gap: 8 })
  const facts: [string, string][] = [
    ['Kunde', t.customer_name],
    ['Kundennummer', t.customer_number ?? ''],
    ['Einsatzort', t.jobsite_address_different
      ? [t.jobsite_name, `${t.jobsite_street} ${t.jobsite_house_no}`.trim(), `${t.jobsite_zip} ${t.jobsite_city}`.trim()].filter(Boolean).join(', ')
      : (t.site_address ?? '').replace(/\n/g, ', ')],
    ['Kundenadresse', t.jobsite_address_different ? (t.site_address ?? '').replace(/\n/g, ', ') : ''],
    ['Auftragsnummer', t.order_number],
    ['Team', team?.name ?? ''],
    ['Verantwortlich', leadId ? name(leadId) : ''],
    ['Monteure', crewIds.filter((id) => id !== leadId).map(name).filter(Boolean).join(', ')],
    ['Montagedatum', fmtDate(t.montage_date, false)],
    ['Erledigt am', fmtDate(t.closed_at)],
  ]
  for (const [k, v] of facts) if (v) w.text(`${k}: ${v}`, { size: 10 })
  w.rule()

  let photoCount = 0
  const loadPhoto = async (path: string) => {
    const { data } = await admin.storage.from('ticket-photos').download(path)
    return data ? new Uint8Array(await data.arrayBuffer()) : null
  }
  const drawPhotos = async (list: { storage_path: string }[], indent: number) => {
    for (const ph of list) {
      if (photoCount >= MAX_PHOTOS) return
      const bytes = await loadPhoto(ph.storage_path)
      if (!bytes) continue
      try {
        await w.image(bytes, ph.storage_path.endsWith('.png'), 240, 180, indent)
        photoCount++
      } catch {
        // Bild nicht lesbar: überspringen
      }
    }
  }

  if (positions?.length) {
    w.heading('Positionen')
    for (const p of positions) {
      const label = p.position_number ? `Pos. ${p.position_number} – ${p.description}` : p.description
      const state = p.state === 'erledigt' ? 'Erledigt' : p.state === 'nicht_erledigt' ? 'Nicht erledigt' : 'Offen'
      w.text(label, { size: 10, bold: true })
      w.text(state, {
        size: 10, indent: 12,
        color: p.state === 'erledigt' ? [0.09, 0.4, 0.2] : p.state === 'nicht_erledigt' ? [0.6, 0.11, 0.11] : grey,
      })
      if (p.state === 'nicht_erledigt' && p.reason) w.text(`Begründung: ${p.reason}`, { size: 10, indent: 12 })
      await drawPhotos((photos ?? []).filter((f) => f.position_id === p.id), 12)
      w.y -= 4
    }
  }

  // Arbeitszeit am Auftrag: erster Beginn, letztes Ende, Summe und die einzelnen Zeiten
  if (times?.length) {
    const end = (e: { started_at: string; ended_at: string | null }) => e.ended_at ?? t.closed_at ?? new Date().toISOString()
    const minutes = (e: { started_at: string; ended_at: string | null }) =>
      Math.max(0, Math.round((new Date(end(e)).getTime() - new Date(e.started_at).getTime()) / 60000))
    const hours = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`
    const clock = (iso: string) => new Date(iso).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })
    const total = times.reduce((a, e) => a + minutes(e), 0)
    const last = times.map(end).sort().at(-1)!
    w.heading('Arbeitszeit')
    w.text(`Arbeitsbeginn: ${fmtDate(times[0].started_at)}`, { size: 10 })
    w.text(`Arbeitsende: ${fmtDate(last)}`, { size: 10 })
    w.text(`Gesamtarbeitszeit: ${hours(total)}`, { size: 10, bold: true, gap: 6 })
    for (const e of times) {
      w.text(`${fmtDate(e.started_at)} – ${clock(end(e))}  ${name(e.installer_id)}  (${hours(minutes(e))})`, { size: 9, indent: 12, color: grey })
    }
  }

  w.heading('Arbeitsbericht')
  w.text(t.work_report || '–', { size: 10 })

  const orderPhotos = (photos ?? []).filter((f) => f.position_id === null)
  if (orderPhotos.length) {
    w.heading('Fotos')
    await drawPhotos(orderPhotos, 0)
  }
  if (photoCount >= MAX_PHOTOS && (photos?.length ?? 0) > MAX_PHOTOS) {
    w.text(`Weitere ${(photos?.length ?? 0) - MAX_PHOTOS} Fotos sind im Auftrag gespeichert.`, { size: 9, color: grey })
  }

  if (t.signature_path) {
    w.heading('Unterschrift des Kunden')
    const sig = await loadPhoto(t.signature_path)
    if (sig) await w.image(sig, true, 220, 90)
    w.text(`${t.signer_name}, ${fmtDate(t.signed_at)}`, { size: 10 })
  }
  const pdf = await doc.save()

  // ---------------------------------------------------------------- E-Mail
  const html = `<p>Guten Tag${t.signer_name ? ' ' + esc(t.signer_name) : ''},</p>
<p>vielen Dank für Ihr Vertrauen. Anbei erhalten Sie den Servicebericht zu unserem Einsatz
„${esc(t.title)}“ vom ${esc(fmtDate(t.closed_at, false))}.</p>
<p>Bei Fragen antworten Sie einfach auf diese E-Mail.</p>
<p>Freundliche Grüße<br>${esc(company)}</p>`

  const res = await fetch(Deno.env.get('RESEND_API_URL') ?? 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [t.customer_email],
      ...(Deno.env.get('MAIL_REPLY_TO') ? { reply_to: Deno.env.get('MAIL_REPLY_TO') } : {}),
      subject: `Servicebericht ${no} – ${t.title}`,
      html,
      attachments: [{ filename: `Servicebericht-${no}.pdf`, content: encodeBase64(pdf) }],
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return fail(`Versand fehlgeschlagen (${res.status}): ${detail.slice(0, 300)}`)
  }

  const sentAt = new Date().toISOString()
  await admin.from('tickets').update({ report_sent_at: sentAt, report_send_error: '' }).eq('id', t.id)
  return reply(200, { sent_at: sentAt })
})
