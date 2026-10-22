import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configMissing = !url || !anonKey

// Einladungs- und Passwort-Links landen mit #type=invite bzw. #type=recovery in der URL.
// Das muss gelesen werden, bevor der Supabase-Client den Hash entfernt.
const hashParams = new URLSearchParams(window.location.hash.slice(1))
export const arrivedViaLinkType = hashParams.get('type')

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
