export interface PositionDraft {
  key: string
  id?: number
  position_number: string
  description: string
}

export function newPositionDraft(): PositionDraft {
  return { key: crypto.randomUUID(), position_number: '', description: '' }
}

export function isEmptyPosition(p: PositionDraft) {
  return !p.position_number.trim() && !p.description.trim()
}

interface Props {
  positions: PositionDraft[]
  onChange: (positions: PositionDraft[]) => void
}

// Eingabeliste für Positionen eines Einsatzes (Pos.-Nr. + was zu tun ist).
export function PositionsEditor({ positions, onChange }: Props) {
  function patch(key: string, change: Partial<PositionDraft>) {
    onChange(positions.map((p) => (p.key === key ? { ...p, ...change } : p)))
  }

  return (
    <div className="positions-editor">
      {positions.map((p, i) => (
        <div className="position-row" key={p.key}>
          <input
            className="pos-no"
            aria-label={`Positionsnummer ${i + 1}`}
            placeholder="Pos."
            maxLength={20}
            value={p.position_number}
            onChange={(e) => patch(p.key, { position_number: e.target.value })}
          />
          <input
            className="pos-desc"
            aria-label={`Beschreibung Position ${i + 1}`}
            placeholder="Was ist zu tun?"
            maxLength={300}
            value={p.description}
            onChange={(e) => patch(p.key, { description: e.target.value })}
          />
          <button
            type="button"
            className="pos-remove"
            aria-label={`Position ${i + 1} entfernen`}
            onClick={() => onChange(positions.filter((x) => x.key !== p.key))}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="link" onClick={() => onChange([...positions, newPositionDraft()])}>
        + Position hinzufügen
      </button>
    </div>
  )
}
