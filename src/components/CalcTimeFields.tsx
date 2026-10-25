import { formatManDays, manDays } from '../lib/types'

interface Props {
  men: string
  days: string
  onMen: (v: string) => void
  onDays: (v: string) => void
}

// Kalkulierte Montagezeit eines Montageauftrags für die Kapazitätsplanung
export function CalcTimeFields({ men, days, onMen, onDays }: Props) {
  const total = manDays(Number(men) || null, Number(days.replace(',', '.')) || null)
  return (
    <div className="field">
      <div className="row">
        <label>
          Kalkulierte Montagezeit (Mann)
          <input type="number" inputMode="numeric" min={1} max={50} step={1} value={men} onChange={(e) => onMen(e.target.value)} />
        </label>
        <label>
          Kalkulierte Montagezeit (Tage)
          <input type="number" inputMode="decimal" min={0.5} max={365} step={0.5} value={days} onChange={(e) => onDays(e.target.value)} />
        </label>
      </div>
      <span className="small muted">
        {total ? <>Benötigt: <strong>{formatManDays(total)}</strong></> : 'Mann × Tage = benötigte Manntage für die Kapazitätsplanung'}
      </span>
    </div>
  )
}

// Werte für die Datenbank: leer = null
export function calcTimeColumns(men: string, days: string) {
  return { calc_men: Number(men) || null, calc_days: Number(days.replace(',', '.')) || null }
}
