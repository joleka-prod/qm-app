import { useEffect, useRef, useState } from 'react'

const MONTHS = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.']

function shift(month: string, n: number) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Monatsauswahl: ← Monat Jahr →; Klick auf den Monat öffnet die Auswahl von Monat und Jahr.
export function MonthPicker({ month, onChange, current }: { month: string; onChange: (m: string) => void; current: string }) {
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(Number(month.slice(0, 4)))
  const box = useRef<HTMLDivElement>(null)
  const [y, m] = month.split('-').map(Number)
  const label = new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  function choose(value: string) {
    onChange(value)
    setOpen(false)
  }

  return (
    <div className="week-nav month-picker" ref={box}>
      <button onClick={() => onChange(shift(month, -1))} aria-label="Voriger Monat">←</button>
      <button
        className="month-picker-label"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setYear(y)
          setOpen(!open)
        }}
      >
        {label} ▾
      </button>
      <button onClick={() => onChange(shift(month, 1))} aria-label="Nächster Monat">→</button>
      {open && (
        <div className="month-picker-pop card" role="dialog" aria-label="Monat und Jahr wählen">
          <div className="month-picker-year">
            <button onClick={() => setYear(year - 1)} aria-label="Voriges Jahr">←</button>
            <strong>{year}</strong>
            <button onClick={() => setYear(year + 1)} aria-label="Nächstes Jahr">→</button>
          </div>
          <div className="month-picker-grid">
            {MONTHS.map((name, i) => {
              const value = `${year}-${String(i + 1).padStart(2, '0')}`
              return (
                <button
                  key={value}
                  className={value === month ? 'primary' : value === current ? 'today-btn' : ''}
                  onClick={() => choose(value)}
                >
                  {name}
                </button>
              )
            })}
          </div>
          <button className="link" onClick={() => choose(current)}>Aktueller Monat</button>
        </div>
      )}
    </div>
  )
}
