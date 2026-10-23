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

export function formatMinutes(m: number) {
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`
}

export function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}
