import { articleLabel, useArticles } from '../lib/articles'
import { formatEuro, parsePrice, priceText, UNITS, UNIT_HINT, type TicketPosition } from '../lib/types'
import { PhotoPicker } from './PhotoPicker'

export interface PositionDraft {
  key: string
  id?: number
  position_number: string
  description: string
  article_id?: number | null
  quantity: string
  unit: string
  price: string
  files: File[]
}

export function newPositionDraft(): PositionDraft {
  return { key: crypto.randomUUID(), position_number: '', description: '', quantity: '1', unit: 'Stk', price: '', files: [] }
}

// Bestehende Position zum Bearbeiten
export function positionToDraft(p: TicketPosition): PositionDraft {
  return {
    key: String(p.id),
    id: p.id,
    position_number: p.position_number,
    description: p.description,
    article_id: p.article_id,
    quantity: String(p.quantity).replace('.', ','),
    unit: p.unit,
    price: priceText(p.price),
    files: [],
  }
}

// Menge, Einheit und Einzelpreis prüfen; wirft eine verständliche Meldung bei Fehleingaben
export function positionPrice(p: PositionDraft, no: number) {
  const quantity = parsePrice(p.quantity)
  const price = parsePrice(p.price)
  const unit = p.unit.trim()
  if (quantity == null || Number.isNaN(quantity) || quantity <= 0)
    throw new Error(`Pos. ${no}: Bitte eine Menge größer als 0 eingeben, z. B. 1 oder 2,5`)
  if (!unit) throw new Error(`Pos. ${no}: Bitte eine Einheit angeben, z. B. Stk oder Std.`)
  if (Number.isNaN(price)) throw new Error(`Pos. ${no}: Bitte den Einzelpreis als Zahl eingeben, z. B. 49,90`)
  return { quantity, unit, price }
}

export function isEmptyPosition(p: PositionDraft) {
  return !p.description.trim()
}

interface Props {
  positions: PositionDraft[]
  onChange: (positions: PositionDraft[]) => void
  withPhotos?: boolean
  // Menge, Einheit und Einzelpreis mit eintragen (nur Planer)
  withPrices?: boolean
}

// Betrag = Menge × Einzelpreis (nur Anzeige, leer solange etwas fehlt)
function amountText(p: PositionDraft) {
  const q = parsePrice(p.quantity)
  const price = parsePrice(p.price)
  if (q == null || price == null || Number.isNaN(q) || Number.isNaN(price)) return ''
  return `= ${formatEuro(Math.round(q * price * 100) / 100)}`
}

// Eingabeliste für Positionen eines Einsatzes. Die Positionsnummer ergibt sich aus der Reihenfolge (1, 2, 3 …).
export function PositionsEditor({ positions, onChange, withPhotos, withPrices }: Props) {
  const { articles } = useArticles()

  function patch(key: string, change: Partial<PositionDraft>) {
    onChange(positions.map((p) => (p.key === key ? { ...p, ...change } : p)))
  }

  function move(i: number, dir: -1 | 1) {
    const next = [...positions]
    ;[next[i], next[i + dir]] = [next[i + dir], next[i]]
    onChange(next)
  }

  function articleText(id: number) {
    const a = articles.find((x) => x.id === id)
    return a ? articleLabel(a) : ''
  }

  // Artikel übernehmen: füllt eine leere letzte Position oder hängt eine neue an
  function addArticle(id: number) {
    const a = articles.find((x) => x.id === id)
    if (!a) return
    const draft = { ...newPositionDraft(), description: a.description, article_id: a.id, unit: a.unit, price: priceText(a.price) }
    const last = positions[positions.length - 1]
    if (last && isEmptyPosition(last) && !last.id) onChange([...positions.slice(0, -1), { ...draft, key: last.key }])
    else onChange([...positions, draft])
  }

  return (
    <div className="positions-editor">
      {withPrices && (
        <datalist id="position-units">
          {UNITS.map((u) => (
            <option key={u} value={u}>{UNIT_HINT[u]}</option>
          ))}
        </datalist>
      )}
      {positions.map((p, i) => (
        <div className="position-item" key={p.key}>
        <div className="position-row">
          <div className="pos-no">
            <span className="pos-no-label">Pos. {i + 1}</span>
            <span className="pos-move">
              <button type="button" aria-label={`Position ${i + 1} nach oben`} disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button
                type="button"
                aria-label={`Position ${i + 1} nach unten`}
                disabled={i === positions.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
            </span>
          </div>
          <div className="pos-desc-wrap">
          {p.article_id && (
            <span className="pos-article">
              Artikel {articleText(p.article_id)}
              <button type="button" className="link" onClick={() => patch(p.key, { article_id: null })}>
                lösen
              </button>
            </span>
          )}
          <textarea
            className="pos-desc"
            rows={Math.max(2, p.description.split('\n').length)}
            aria-label={`Beschreibung Position ${i + 1}`}
            placeholder="Was ist zu tun?"
            maxLength={2000}
            value={p.description}
            onChange={(e) => patch(p.key, { description: e.target.value })}
          />
          </div>
          <button
            type="button"
            className="pos-remove"
            aria-label={`Position ${i + 1} entfernen`}
            onClick={() => onChange(positions.filter((x) => x.key !== p.key))}
          >
            ×
          </button>
        </div>
        {withPrices && (
          <div className="position-price">
            <label>
              Menge
              <input
                inputMode="decimal"
                aria-label={`Menge Position ${i + 1}`}
                value={p.quantity}
                onChange={(e) => patch(p.key, { quantity: e.target.value })}
              />
            </label>
            <label>
              Einheit
              <input
                list="position-units"
                maxLength={20}
                aria-label={`Einheit Position ${i + 1}`}
                value={p.unit}
                onChange={(e) => patch(p.key, { unit: e.target.value })}
              />
            </label>
            <label>
              Einzelpreis € (netto)
              <input
                inputMode="decimal"
                placeholder="0,00"
                aria-label={`Einzelpreis Position ${i + 1}`}
                value={p.price}
                onChange={(e) => patch(p.key, { price: e.target.value })}
              />
            </label>
            <span className="position-amount">{amountText(p)}</span>
          </div>
        )}
        {withPhotos && (
          <div className="position-photos">
            <PhotoPicker files={p.files} onChange={(files) => patch(p.key, { files })} />
          </div>
        )}
        </div>
      ))}
      <div className="positions-add">
        <button type="button" className="link" onClick={() => onChange([...positions, newPositionDraft()])}>
          + Position hinzufügen
        </button>
        {articles.length > 0 && (
          <select
            aria-label="Artikel als Position hinzufügen"
            value=""
            onChange={(e) => e.target.value && addArticle(Number(e.target.value))}
          >
            <option value="">+ Artikel auswählen…</option>
            {articles.map((a) => (
              <option key={a.id} value={a.id}>{articleLabel(a)}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}
