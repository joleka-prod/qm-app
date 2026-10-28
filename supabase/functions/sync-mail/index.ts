// E-Mails den Kunden zuordnen (Fabian, 2026-10-28): liest die Postfächer aus mail_mailboxes über Microsoft Graph mit
// (Posteingang und Gesendete Elemente, Delta-Abfrage) und legt bei Treffern im Kundenstamm einen Eintrag „E-Mail“ im
// Kommunikationsverlauf an. Mails ohne Treffer werden nicht gespeichert. Die Zustellung selbst läuft unverändert über M365.
// Aufruf alle 5 Minuten per pg_cron (POST, Header x-sync-key), Verify JWT aus.
// Secrets: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET (Entra-App, Recht „Application Mail.Read“ nur auf die
// freigegebenen Postfächer), MAIL_SYNC_KEY; optional MAIL_OWN_DOMAINS (Standard joleka.de, eigene Adressen nie zuordnen).
import { createClient } from 'npm:@supabase/supabase-js@2'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const PAGES_PER_RUN = 10 // je Ordner und Lauf höchstens 10 × 50 Mails, der Rest folgt im nächsten Lauf
const MAX_BODY = 20000

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
}

function sameKey(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

interface Recipient { emailAddress?: { address?: string; name?: string } }
interface GraphMessage {
  id: string
  '@removed'?: unknown
  internetMessageId?: string
  subject?: string
  body?: { content?: string }
  from?: Recipient
  toRecipients?: Recipient[]
  ccRecipients?: Recipient[]
  receivedDateTime?: string
  sentDateTime?: string
  hasAttachments?: boolean
  isDraft?: boolean
}

const addr = (r?: Recipient) => (r?.emailAddress?.address ?? '').trim().toLowerCase()
const label = (r?: Recipient) => {
  const a = r?.emailAddress?.address ?? ''
  const n = r?.emailAddress?.name ?? ''
  return n && n.toLowerCase() !== a.toLowerCase() ? `${n} <${a}>` : a
}

async function getToken() {
  const tenant = Deno.env.get('MS_TENANT_ID') ?? ''
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: Deno.env.get('MS_CLIENT_ID') ?? '',
      client_secret: Deno.env.get('MS_CLIENT_SECRET') ?? '',
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Anmeldung bei Microsoft fehlgeschlagen: ${data.error_description ?? data.error ?? res.status}`)
  return data.access_token as string
}

async function graph(token: string, url: string) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Prefer: 'outlook.body-content-type="text", odata.maxpagesize=50',
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Microsoft Graph ${res.status}: ${data?.error?.message ?? res.statusText}`)
  return data
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'Nur POST' })
  const key = Deno.env.get('MAIL_SYNC_KEY') ?? ''
  if (key.length < 20) return reply(500, { error: 'MAIL_SYNC_KEY ist nicht (oder zu kurz) gesetzt.' })
  if (!sameKey(req.headers.get('x-sync-key') ?? '', key)) return reply(401, { error: 'Falscher Sync-Schlüssel' })

  const ownDomains = (Deno.env.get('MAIL_OWN_DOMAINS') ?? 'joleka.de').toLowerCase().split(/[,;\s]+/).filter(Boolean)
  const isOwn = (a: string) => ownDomains.some((d) => a.endsWith(`@${d}`))

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: boxes, error } = await admin.from('mail_mailboxes').select('*').eq('active', true)
  if (error) return reply(500, { error: error.message })

  let token: string
  try {
    token = await getToken()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await admin.from('mail_mailboxes').update({ last_error: msg }).eq('active', true)
    return reply(500, { error: msg })
  }

  const result: Record<string, { gelesen: number; zugeordnet: number; fehler?: string }> = {}

  for (const box of boxes ?? []) {
    const stats = { gelesen: 0, zugeordnet: 0 } as { gelesen: number; zugeordnet: number; fehler?: string }
    result[box.address] = stats
    let lastError: string | null = null
    try {
      for (const folder of ['inbox', 'sentitems'] as const) {
        const outgoing = folder === 'sentitems'
        const linkCol = outgoing ? 'sent_link' : 'inbox_link'
        const dateField = outgoing ? 'sentDateTime' : 'receivedDateTime'
        let url: string = box[linkCol] ??
          `${GRAPH}/users/${encodeURIComponent(box.address)}/mailFolders/${folder}/messages/delta` +
            `?$select=internetMessageId,subject,body,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,hasAttachments,isDraft` +
            `&$filter=receivedDateTime ge ${new Date(box.import_from).toISOString()}`

        for (let page = 0; page < PAGES_PER_RUN && url; page++) {
          const data = await graph(token, url)
          const msgs = ((data.value ?? []) as GraphMessage[]).filter((m) => !m['@removed'] && !m.isDraft)
          stats.gelesen += msgs.length

          // Kundenadressen: eingehend der Absender, ausgehend alle Empfänger; eigene Adressen nie
          const partners = new Map<string, string[]>()
          for (const m of msgs) {
            const list = outgoing ? [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])].map(addr) : [addr(m.from)]
            partners.set(m.id, [...new Set(list.filter((a) => a && !isOwn(a)))])
          }
          const all = [...new Set([...partners.values()].flat())]
          const { data: matches, error: mErr } = all.length
            ? await admin.rpc('match_mail_addresses', { p_addresses: all })
            : { data: [], error: null }
          if (mErr) throw new Error(mErr.message)
          const byAddress = new Map<string, { customer_id: number; contact_id: number | null }[]>()
          for (const r of (matches ?? []) as { address: string; customer_id: number; contact_id: number | null }[]) {
            byAddress.set(r.address, [...(byAddress.get(r.address) ?? []), r])
          }

          const rows: Record<string, unknown>[] = []
          for (const m of msgs) {
            // je Kunde ein Eintrag; Treffer über einen Ansprechpartner gehen vor
            const perCustomer = new Map<number, number | null>()
            for (const a of partners.get(m.id) ?? []) {
              for (const r of byAddress.get(a) ?? []) {
                if (!perCustomer.has(r.customer_id) || r.contact_id) perCustomer.set(r.customer_id, r.contact_id)
              }
            }
            if (perCustomer.size === 0) continue

            let attachments: string[] = []
            if (m.hasAttachments) {
              const att = await graph(token, `${GRAPH}/users/${encodeURIComponent(box.address)}/messages/${m.id}/attachments?$select=name,isInline`)
              attachments = ((att.value ?? []) as { name?: string; isInline?: boolean }[])
                .filter((x) => !x.isInline && x.name)
                .map((x) => x.name!)
            }
            const body = (m.body?.content ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
            for (const [customerId, contactId] of perCustomer) {
              rows.push({
                customer_id: customerId,
                contact_id: contactId,
                kind: 'email',
                subject: (m.subject ?? '').trim() || '(ohne Betreff)',
                body: body.length > MAX_BODY ? `${body.slice(0, MAX_BODY)}\n…` : body,
                created_at: m[dateField] ?? new Date().toISOString(),
                mail_direction: outgoing ? 'ausgang' : 'eingang',
                mail_mailbox: box.address,
                mail_from: label(m.from),
                mail_to: [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])].map(label).join(', '),
                mail_attachments: attachments,
                mail_message_id: m.internetMessageId || m.id,
              })
            }
          }
          if (rows.length) {
            const { error: iErr, count } = await admin
              .from('customer_notes')
              .upsert(rows, { onConflict: 'customer_id,mail_message_id', ignoreDuplicates: true, count: 'exact' })
            if (iErr) throw new Error(iErr.message)
            stats.zugeordnet += count ?? 0
          }

          // Fortsetzung bzw. neuer Stand; erst nach dem Speichern merken, damit nichts verloren geht
          const next = data['@odata.nextLink'] ?? data['@odata.deltaLink']
          await admin.from('mail_mailboxes').update({ [linkCol]: next }).eq('address', box.address)
          url = data['@odata.nextLink'] ?? ''
        }
      }
    } catch (e) {
      stats.fehler = e instanceof Error ? e.message : String(e)
      lastError = stats.fehler
      // abgelaufener Delta-Stand: neu ab import_from aufsetzen, Doppelte verhindert customer_notes_mail_unique
      if (/Graph 410|SyncState/i.test(stats.fehler)) {
        await admin.from('mail_mailboxes').update({ inbox_link: null, sent_link: null }).eq('address', box.address)
      }
    }
    await admin.from('mail_mailboxes').update({ last_sync_at: new Date().toISOString(), last_error: lastError }).eq('address', box.address)
  }

  return reply(200, result)
})
