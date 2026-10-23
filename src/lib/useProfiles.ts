import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Profile } from './types'

export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([])

  const reload = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').order('full_name')
    setProfiles((data ?? []) as Profile[])
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const byId = Object.fromEntries(profiles.map((p) => [p.id, p])) as Record<string, Profile>
  const leads = profiles.filter((p) => p.active && (p.role === 'teamleiter' || p.role === 'admin'))

  const installers = profiles.filter((p) => p.active && p.role === 'monteur')

  return { profiles, byId, leads, installers, reload }
}
