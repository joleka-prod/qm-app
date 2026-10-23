import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

// Lässt den Servicebericht als PDF an den Kunden schicken (Edge Function send-report).
export async function sendReport(ticketId: number, force = false) {
  const { error } = await supabase.functions.invoke('send-report', { body: { ticket_id: ticketId, force } })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null)
      throw new Error(payload?.error ?? 'Bericht konnte nicht gesendet werden')
    }
    throw new Error('E-Mail-Versand nicht erreichbar. Ist die Funktion „send-report“ in Supabase eingerichtet?')
  }
}
