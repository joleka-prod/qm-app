import { addDays, isoDate, startOfWeek, weekNumber } from '../lib/types'

const WEEKS = 26

export function weekRange(monday: Date) {
  const f = (d: Date) => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  return `${f(monday)}–${f(addDays(monday, 5))}`
}

// Auswahl einer Kalenderwoche (Wert = Montag als ISO-Datum) für die Grobplanung
export function WeekSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const first = startOfWeek(new Date())
  const options = Array.from({ length: WEEKS }, (_, i) => isoDate(addDays(first, i * 7)))
  if (value && !options.includes(value)) options.unshift(value)
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Nicht vorgemerkt</option>
      {options.map((d) => {
        const monday = new Date(d + 'T00:00')
        return (
          <option key={d} value={d}>
            KW {weekNumber(monday)} ({weekRange(monday)})
          </option>
        )
      })}
    </select>
  )
}
