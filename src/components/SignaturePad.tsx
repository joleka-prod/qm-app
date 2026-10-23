import { useEffect, useRef, useState } from 'react'

interface Props {
  onChange: (hasInk: boolean) => void
  canvasRef: React.RefObject<HTMLCanvasElement | null>
}

// Unterschriftsfeld für Finger oder Maus. Zeichnet mit Pointer-Events, damit es auf Handy und PC gleich funktioniert.
export function SignaturePad({ onChange, canvasRef }: Props) {
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const { width, height } = canvas.getBoundingClientRect()
    canvas.width = width * ratio
    canvas.height = height * ratio
    const ctx = canvas.getContext('2d')!
    ctx.scale(ratio, ratio)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111827'
  }, [canvasRef])

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function clear() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const { width, height } = canvas.getBoundingClientRect()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    setHasInk(false)
    onChange(false)
  }

  return (
    <div className="signature-pad">
      <canvas
        ref={canvasRef}
        aria-label="Unterschriftsfeld"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drawing.current = true
          const ctx = e.currentTarget.getContext('2d')!
          const p = point(e)
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(p.x + 0.1, p.y + 0.1)
          ctx.stroke()
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return
          const ctx = e.currentTarget.getContext('2d')!
          const p = point(e)
          ctx.lineTo(p.x, p.y)
          ctx.stroke()
          if (!hasInk) {
            setHasInk(true)
            onChange(true)
          }
        }}
        onPointerUp={() => (drawing.current = false)}
        onPointerCancel={() => (drawing.current = false)}
      />
      <div className="signature-line">Unterschrift</div>
      <button type="button" className="link" onClick={clear} disabled={!hasInk}>Löschen</button>
    </div>
  )
}

export function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Unterschrift konnte nicht gespeichert werden'))), 'image/png'),
  )
}
