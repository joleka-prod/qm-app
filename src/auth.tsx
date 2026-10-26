import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { clearOfflineCache, setOfflineUser } from './lib/offline'
import { arrivedViaLinkType, storedSession, supabase } from './lib/supabase'
import type { Profile } from './lib/types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  needsPassword: boolean
  setNeedsPassword: (v: boolean) => void
  reloadProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsPassword, setNeedsPassword] = useState(
    arrivedViaLinkType === 'invite' || arrivedViaLinkType === 'recovery',
  )

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null)
      return
    }
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    setProfile(data as Profile | null)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data, error }) => {
      const s = data.session ?? (error ? storedSession() : null)
      setSession(s)
      setOfflineUser(s?.user.id ?? null)
      await loadProfile(s?.user.id)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      const s = next ?? (event === 'SIGNED_OUT' ? null : storedSession())
      if (event === 'SIGNED_OUT') void clearOfflineCache()
      setSession(s)
      setOfflineUser(s?.user.id ?? null)
      if (event === 'PASSWORD_RECOVERY') setNeedsPassword(true)
      // Profil außerhalb des Callbacks laden, sonst blockiert supabase-js
      setTimeout(() => loadProfile(s?.user.id), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const reloadProfile = useCallback(() => loadProfile(session?.user.id), [loadProfile, session])

  return (
    <AuthContext.Provider value={{ session, profile, loading, needsPassword, setNeedsPassword, reloadProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth außerhalb von AuthProvider')
  return ctx
}
