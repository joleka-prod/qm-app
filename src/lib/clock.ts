import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface Attendance {
  id: number
  installer_id: string
  started_at: string
  ended_at: string | null
  note: string
  edited_by: string | null
}

const EVENT = 'clock-changed'

// Meldet allen Anzeigen (Stempeluhr oben, Auftrag), dass sich die Zeiterfassung geändert hat
export function notifyClockChanged() {
  window.dispatchEvent(new Event(EVENT))
}

export function useClockChanged(fn: () => void) {
  useEffect(() => {
    window.addEventListener(EVENT, fn)
    return () => window.removeEventListener(EVENT, fn)
  }, [fn])
}

// Laufende Stempelzeit des angemeldeten Monteurs
export function useClock(userId: string | undefined) {
  const [running, setRunning] = useState<Attendance | null>(null)
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(async () => {
    if (!userId) return
    const { data } = await supabase.from('attendance').select('*').eq('installer_id', userId).is('ended_at', null).maybeSingle()
    setRunning((data ?? null) as Attendance | null)
    setLoaded(true)
  }, [userId])

  useEffect(() => {
    reload()
  }, [reload])
  useClockChanged(reload)

  async function clockIn() {
    const { error } = await supabase.rpc('clock_in')
    notifyClockChanged()
    return error?.message ?? ''
  }

  async function clockOut() {
    const { error } = await supabase.rpc('clock_out')
    notifyClockChanged()
    return error?.message ?? ''
  }

  return { running, loaded, clockIn, clockOut }
}

export function minutesBetween(start: string, end: string | null, now = Date.now()) {
  const e = end ? new Date(end).getTime() : now
  return Math.max(0, Math.round((e - new Date(start).getTime()) / 60000))
}

// Feste Pausen, die automatisch von der gestempelten Zeit abgezogen werden, soweit man in dieser Zeit
// eingestempelt war (Fabian 2026-10-24). Muss zu public.fixed_break_minutes in der Datenbank passen.
export const FIXED_BREAKS: [number, number, number, number][] = [
  [9, 0, 9, 15], // Frühstückspause
  [12, 0, 12, 30], // Mittagspause
]

export function fixedBreakMinutes(start: string, end: string | null, now = Date.now()) {
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : now
  let ms = 0
  for (let d = new Date(s); d.getTime() <= e; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    for (const [h1, m1, h2, m2] of FIXED_BREAKS) {
      const from = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h1, m1).getTime()
      const to = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h2, m2).getTime()
      ms += Math.max(0, Math.min(e, to) - Math.max(s, from))
    }
  }
  return Math.round(ms / 60000)
}

// Arbeitszeit einer Stempelzeit ohne die festen Pausen
export function workMinutes(start: string, end: string | null, now = Date.now()) {
  return Math.max(0, minutesBetween(start, end, now) - fixedBreakMinutes(start, end, now))
}

export function formatMinutes(m: number) {
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`
}

export function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}
