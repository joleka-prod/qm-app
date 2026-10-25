import { OPENING_SHORT, type Opening, type WindowDesign } from '../lib/windows'

// Ansicht von innen, Maße in mm. Öffnungssymbole: die Spitze des Dreiecks zeigt zur Griffseite (Kipp: nach oben).
const FRAME = 60
const SASH = 50

interface Props {
  w: WindowDesign
  // ausgewähltes Feld: 0..n-1 = Flügelfelder, -1 = Oberlicht
  selected?: number | null
  onSelect?: (field: number) => void
}

export function WindowDrawing({ w, selected, onSelect }: Props) {
  const font = Math.max(w.width, w.height) / 28
  const dim = font * 2.2
  const left = w.transom ? dim * 2 + font : dim + font
  const bottom = w.columns.length > 1 ? dim * 2 + font : dim + font
  const pad = font
  const vbW = left + w.width + pad
  const vbH = pad + w.height + bottom
  const ox = left
  const oy = pad
  const th = w.transom?.height ?? 0

  const fields: { x: number; y: number; w: number; h: number; opening: Opening; index: number }[] = []
  if (w.transom) fields.push({ x: ox, y: oy, w: w.width, h: th, opening: w.transom.opening, index: -1 })
  let x = ox
  w.columns.forEach((cw, i) => {
    fields.push({ x, y: oy + th, w: cw, h: w.height - th, opening: w.openings[i], index: i })
    x += cw
  })

  return (
    <svg className="window-drawing" viewBox={`0 0 ${vbW} ${vbH}`} role="img" aria-label="Fensterzeichnung, Ansicht von innen">
      <rect x={ox} y={oy} width={w.width} height={w.height} className="wd-frame" />
      {fields.map((f) => (
        <Field key={f.index} f={f} active={selected === f.index} onSelect={onSelect} font={font} />
      ))}

      {/* Breiten */}
      {w.columns.length > 1 &&
        w.columns.map((cw, i) => {
          const sx = ox + w.columns.slice(0, i).reduce((a, b) => a + b, 0)
          return <Dim key={i} x1={sx} y1={oy + w.height + dim} x2={sx + cw} y2={oy + w.height + dim} label={cw} font={font} />
        })}
      <Dim x1={ox} y1={vbH - font} x2={ox + w.width} y2={vbH - font} label={w.width} font={font} />

      {/* Höhen */}
      {w.transom && (
        <>
          <Dim x1={left - dim} y1={oy} x2={left - dim} y2={oy + th} label={th} font={font} vertical />
          <Dim x1={left - dim} y1={oy + th} x2={left - dim} y2={oy + w.height} label={w.height - th} font={font} vertical />
        </>
      )}
      <Dim x1={font} y1={oy} x2={font} y2={oy + w.height} label={w.height} font={font} vertical />
    </svg>
  )
}

function Field({
  f,
  active,
  onSelect,
  font,
}: {
  f: { x: number; y: number; w: number; h: number; opening: Opening; index: number }
  active: boolean
  onSelect?: (i: number) => void
  font: number
}) {
  const movable = f.opening !== 'fest'
  // Rahmen, darin ggf. Flügelrahmen, darin Glas
  const g = { x: f.x + FRAME, y: f.y + FRAME, w: f.w - 2 * FRAME, h: f.h - 2 * FRAME }
  const glass = movable ? { x: g.x + SASH, y: g.y + SASH, w: g.w - 2 * SASH, h: g.h - 2 * SASH } : g
  const hingeLeft = f.opening === 'dl' || f.opening === 'dkl'
  const hingeRight = f.opening === 'dr' || f.opening === 'dkr'
  const tilt = f.opening === 'k' || f.opening === 'dkl' || f.opening === 'dkr'
  const s = g // Symbol über den Flügel
  const midY = s.y + s.h / 2
  const handle = Math.max(font * 0.35, 12)

  return (
    <g className={`wd-field${active ? ' active' : ''}`} onClick={onSelect ? () => onSelect(f.index) : undefined} style={onSelect ? { cursor: 'pointer' } : undefined}>
      <rect x={f.x} y={f.y} width={f.w} height={f.h} className="wd-frame" />
      {movable && <rect x={g.x} y={g.y} width={g.w} height={g.h} className="wd-sash" />}
      <rect x={glass.x} y={glass.y} width={glass.w} height={glass.h} className="wd-glass" />
      {hingeLeft && <polyline points={`${s.x},${s.y} ${s.x + s.w},${midY} ${s.x},${s.y + s.h}`} className="wd-symbol" />}
      {hingeRight && <polyline points={`${s.x + s.w},${s.y} ${s.x},${midY} ${s.x + s.w},${s.y + s.h}`} className="wd-symbol" />}
      {tilt && <polyline points={`${s.x},${s.y + s.h} ${s.x + s.w / 2},${s.y} ${s.x + s.w},${s.y + s.h}`} className="wd-symbol" />}
      {/* Griff gegenüber der Bandseite, beim reinen Kippflügel oben */}
      {hingeLeft && <rect x={s.x + s.w - SASH / 2 - handle / 2} y={midY - handle * 2} width={handle} height={handle * 4} className="wd-handle" />}
      {hingeRight && <rect x={s.x + SASH / 2 - handle / 2} y={midY - handle * 2} width={handle} height={handle * 4} className="wd-handle" />}
      {f.opening === 'k' && <rect x={s.x + s.w / 2 - handle * 2} y={s.y + SASH / 2 - handle / 2} width={handle * 4} height={handle} className="wd-handle" />}
      <text x={f.x + f.w / 2} y={f.y + f.h / 2} fontSize={font} className="wd-label" dominantBaseline="middle" textAnchor="middle">
        {OPENING_SHORT[f.opening]}
      </text>
    </g>
  )
}

function Dim({ x1, y1, x2, y2, label, font, vertical }: { x1: number; y1: number; x2: number; y2: number; label: number; font: number; vertical?: boolean }) {
  const t = font * 0.4
  const cx = (x1 + x2) / 2
  const cy = (y1 + y2) / 2
  return (
    <g className="wd-dim">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      {vertical ? (
        <>
          <line x1={x1 - t} y1={y1} x2={x1 + t} y2={y1} />
          <line x1={x2 - t} y1={y2} x2={x2 + t} y2={y2} />
          <text x={cx - t} y={cy} fontSize={font * 0.8} textAnchor="middle" transform={`rotate(-90 ${cx - t} ${cy})`}>{label}</text>
        </>
      ) : (
        <>
          <line x1={x1} y1={y1 - t} x2={x1} y2={y1 + t} />
          <line x1={x2} y1={y2 - t} x2={x2} y2={y2 + t} />
          <text x={cx} y={cy - t} fontSize={font * 0.8} textAnchor="middle">{label}</text>
        </>
      )}
    </g>
  )
}
