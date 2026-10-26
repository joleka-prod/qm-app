import { signedUrls } from './photos'
import { supabase } from './supabase'
import { loadMembers, type TeamMember } from './teams'
import { addDays, isoDate, startOfWeek, type Ticket, type TicketPhoto } from './types'
import { markSaved } from './offline'

// Abfragen der Monteur-Seiten. Sie liegen hier, damit das Vorab-Speichern für den Offline-Modus
// genau dieselben Anfragen stellt wie die Seiten (gleiche Anfrage = gleicher Eintrag im Handy-Speicher).

// Persönlicher Kalender: Einsätze der Woche und offene aus den letzten 90 Tagen
export async function loadInstallerWeek(installerId: string, days: string[], today: string) {
  const since = isoDate(addDays(new Date(today + 'T00:00'), -90))
  const [week, mine] = await Promise.all([loadMembers(days[0], days[6]), loadMembers(since, days[6], installerId)])
  const pairs = new Set(mine.map((m) => `${m.team_id}|${m.day}`))
  const teamIds = [...new Set(mine.map((m) => m.team_id))]
  const onMyTeam = (t: Ticket) => pairs.has(`${t.team_id}|${t.montage_date}`)
  if (teamIds.length === 0) return { jobs: [] as Ticket[], overdue: [] as Ticket[], members: week }
  const [w, o] = await Promise.all([
    supabase
      .from('tickets')
      .select('*, ticket_positions(count)')
      .in('team_id', teamIds)
      .gte('montage_date', days[0])
      .lte('montage_date', days[6]),
    supabase
      .from('tickets')
      .select('*, ticket_positions(count)')
      .in('team_id', teamIds)
      .gte('montage_date', since)
      .lt('montage_date', today)
      .neq('status', 'abgeschlossen')
      .order('montage_date'),
  ])
  return {
    jobs: ((w.data ?? []) as Ticket[]).filter(onMyTeam),
    overdue: ((o.data ?? []) as Ticket[]).filter(onMyTeam),
    members: week as TeamMember[],
  }
}

export function weekDays(weekStart: Date) {
  return Array.from({ length: 7 }, (_, i) => isoDate(addDays(weekStart, i)))
}

// Auftrag: Stammdaten, Fotos, Verlauf, Löschantrag, Positionen
export function loadTicketCore(ticketId: number) {
  return Promise.all([
    supabase.from('tickets').select('*').eq('id', ticketId).maybeSingle(),
    supabase.from('ticket_photos').select('*').eq('ticket_id', ticketId).order('created_at'),
    supabase.from('ticket_events').select('*').eq('ticket_id', ticketId).order('created_at').order('id'),
    supabase.from('deletion_requests').select('*').eq('ticket_id', ticketId).maybeSingle(),
    supabase.from('ticket_positions').select('*').eq('ticket_id', ticketId).order('sort').order('id'),
  ])
}

export function loadCrew(teamId: number, day: string) {
  return supabase.from('team_members').select('installer_id, lead').eq('team_id', teamId).eq('day', day)
}

export function loadTimeEntries(ticketId: number, me: string) {
  return Promise.all([
    supabase.from('time_entries').select('*').eq('ticket_id', ticketId).order('started_at'),
    supabase.from('time_entries').select('*').eq('installer_id', me).is('ended_at', null).maybeSingle(),
  ])
}

export function loadChain(ticketId: number) {
  return supabase.rpc('ticket_chain', { p_ticket_id: ticketId })
}

// ---------------------------------------------------------------- Vorab speichern

let lastRun = 0

// Speichert die Einsätze des Monteurs für heute und die nächsten 7 Tage samt offener Einsätze
// aus den Vortagen im Handy, inklusive Fotos. Läuft höchstens alle 5 Minuten.
export async function prefetchForInstaller(userId: string, force = false) {
  if (!navigator.onLine || (!force && Date.now() - lastRun < 5 * 60 * 1000)) return
  lastRun = Date.now()
  const today = isoDate(new Date())
  const end = isoDate(addDays(new Date(), 7))
  const weeks = [startOfWeek(new Date()), startOfWeek(addDays(new Date(), 7))]
  const ids = new Set<number>()
  try {
    for (const ws of weeks) {
      const { jobs, overdue } = await loadInstallerWeek(userId, weekDays(ws), today)
      for (const t of [...jobs, ...overdue]) if (t.montage_date && t.montage_date <= end) ids.add(t.id)
    }
    for (const id of ids) {
      const [t, p] = await loadTicketCore(id)
      const ticket = t.data as Ticket | null
      if (!ticket) continue
      await Promise.all([
        ticket.team_id && ticket.montage_date ? loadCrew(ticket.team_id, ticket.montage_date) : null,
        loadTimeEntries(id, userId),
        loadChain(id),
      ])
      const paths = ((p.data ?? []) as TicketPhoto[]).map((x) => x.storage_path)
      if (ticket.signature_path) paths.push(ticket.signature_path)
      const urls = await signedUrls(paths).catch(() => ({}) as Record<string, string>)
      // Bilder einmal laden, damit der Service Worker sie für offline ablegt
      await Promise.all(Object.values(urls).map((u) => fetch(u).catch(() => undefined)))
    }
    await markSaved()
  } catch {
    lastRun = 0
  }
}
