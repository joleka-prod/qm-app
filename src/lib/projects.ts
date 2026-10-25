import { supabase } from './supabase'
import type { Customer } from './customers'

export type ProjectRole = 'bauherr' | 'bautraeger' | 'generalunternehmer' | 'architekt' | 'sonstige'

export interface Project {
  id: number
  project_number: string
  name: string
  street: string
  house_no: string
  zip: string
  city: string
  country: string
  status: 'aktiv' | 'abgeschlossen'
  notes: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ProjectCustomer {
  id: number
  project_id: number
  customer_id: number
  role: ProjectRole
  note: string
  customers?: Customer
}

export const ROLE_LABEL: Record<ProjectRole, string> = {
  bauherr: 'Bauherr / Endkunde',
  bautraeger: 'Bauträger',
  generalunternehmer: 'Generalunternehmer',
  architekt: 'Architekt',
  sonstige: 'Sonstige',
}

export const PROJECT_ROLES = Object.keys(ROLE_LABEL) as ProjectRole[]

// Standardrolle aus der Kundengruppe (wie project_role_for in der Datenbank)
export function roleForGroup(group: Customer['customer_group']): ProjectRole {
  return group === 'bautraeger' || group === 'generalunternehmer' || group === 'architekt' ? group : 'bauherr'
}

export function projectAddress(p: Pick<Project, 'street' | 'house_no' | 'zip' | 'city' | 'country'>) {
  return [`${p.street} ${p.house_no}`.trim(), `${p.zip} ${p.city}`.trim(), p.country === 'Deutschland' ? '' : p.country]
    .filter(Boolean)
    .join(', ')
}

export function projectLabel(p: Pick<Project, 'project_number' | 'name'>) {
  return `${p.project_number} ${p.name}`
}

// Suche nach Nummer, Name, Ort, Straße
export async function searchProjects(query: string, limit = 8) {
  const q = query.trim().replace(/[%_,()]/g, ' ').trim()
  if (q.length < 2) return []
  const like = `%${q}%`
  const { data } = await supabase
    .from('projects')
    .select('*')
    .or(`name.ilike.${like},project_number.ilike.${like},city.ilike.${like},street.ilike.${like}`)
    .order('status')
    .order('name')
    .limit(limit)
  return (data ?? []) as Project[]
}

