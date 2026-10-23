import type { Team } from '../lib/teams'
import { AREA_LABEL, SERVICE_AREAS } from '../lib/types'

// Auswahl eines Teams, gruppiert nach Montage und Kundendienst
export function TeamSelect({ teams, value, onChange }: { teams: Team[]; value: string; onChange: (id: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">– nicht eingeplant –</option>
      {SERVICE_AREAS.map((a) => (
        <optgroup key={a} label={AREA_LABEL[a]}>
          {teams.filter((t) => t.area === a).map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
