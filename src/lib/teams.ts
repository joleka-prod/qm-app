import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { ServiceArea } from './types'

export interface Team {
  id: number
  name: string
  area: ServiceArea
  sort: number
  active: boolean
}

export interface TeamMember {
  team_id: number
  day: string
  installer_id: string
}

export function useTeams() {
  const [teams, setTeams] = useState<Team[]>([])
  useEffect(() => {
    supabase
      .from('teams')
      .select('*')
      .order('sort')
      .then(({ data }) => setTeams((data ?? []) as Team[]))
  }, [])
  const teamById = Object.fromEntries(teams.map((t) => [t.id, t])) as Record<number, Team>
  return { teams: teams.filter((t) => t.active), allTeams: teams, teamById }
}

// Besetzung der Teams in einem Zeitraum
export async function loadMembers(from: string, to: string, installerId?: string) {
  let q = supabase.from('team_members').select('team_id, day, installer_id').gte('day', from).lte('day', to)
  if (installerId) q = q.eq('installer_id', installerId)
  const { data } = await q
  return (data ?? []) as TeamMember[]
}
