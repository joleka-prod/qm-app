import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Role } from './types'

async function call(body: Record<string, string>) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null)
      throw new Error(payload?.error ?? 'Aktion fehlgeschlagen')
    }
    throw new Error('Benutzerverwaltung nicht erreichbar. Ist die Funktion „admin-users“ in Supabase eingerichtet?')
  }
  return data
}

export function createUser(u: { email: string; full_name: string; role: Role; password: string }) {
  return call({ action: 'create', ...u })
}

export function setPassword(userId: string, password: string) {
  return call({ action: 'set_password', user_id: userId, password })
}

// Ändert die Login-E-Mail (Supabase Auth) und die Adresse im Profil
export function updateEmail(userId: string, email: string) {
  return call({ action: 'update_email', user_id: userId, email })
}

// Gut lesbares Startpasswort, z. B. "Kran-7342-Bogen"
export function generatePassword() {
  const words = ['Anker', 'Bogen', 'Drehe', 'Feder', 'Gabel', 'Hobel', 'Kran', 'Leiste', 'Mutter', 'Nabe', 'Rolle', 'Schraube', 'Welle', 'Zange']
  const rnd = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n
  return `${words[rnd(words.length)]}-${1000 + rnd(9000)}-${words[rnd(words.length)]}`
}
