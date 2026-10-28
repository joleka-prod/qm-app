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
  // aus 3E abgeglichen: Nummer, Bezeichnung, Status und Adresse (vom Kunden) nur in 3E änderbar
  source: 'app' | '3e'
  ext_id: string | null
  synced_at: string | null
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

export type ProjectAddress = Pick<Project, 'street' | 'house_no' | 'zip' | 'city' | 'country'>

export function projectAddress(p: ProjectAddress) {
  return [`${p.street} ${p.house_no}`.trim(), `${p.zip} ${p.city}`.trim(), p.country === 'Deutschland' ? '' : p.country]
    .filter(Boolean)
    .join(', ')
}

// gleiche Adresse wie in project_for_ticket: Straße, Hausnummer, PLZ
export function sameAddress(a: ProjectAddress, b: ProjectAddress) {
  const n = (v: string) => v.trim().toLowerCase()
  return n(a.street) === n(b.street) && n(a.house_no) === n(b.house_no) && a.zip.trim() === b.zip.trim()
}

export function projectLabel(p: Pick<Project, 'project_number' | 'name'>) {
  return `${p.project_number} ${p.name}`
}

// Suche nach Nummer, Name, Ort, Straße und beteiligtem Kunden (RPC search_projects, über 18.000 Bauvorhaben aus 3E)
export async function searchProjects(query: string, limit = 8) {
  const q = query.trim()
  if (q.length < 2) return []
  const { data } = await supabase.rpc('search_projects', { p_query: q, p_status: '', p_limit: limit })
  const rows = ((data ?? {}) as { rows?: Project[] }).rows ?? []
  // laufende zuerst
  return rows.sort((a, b) => (a.status === b.status ? 0 : a.status === 'aktiv' ? -1 : 1))
}
