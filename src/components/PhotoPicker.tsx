import { useEffect, useMemo } from 'react'

interface Props {
  files: File[]
  onChange: (files: File[]) => void
}

// Auf dem Handy bietet der Browser hier Kamera oder Galerie an.
export function PhotoPicker({ files, onChange }: Props) {
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])

  return (
    <div className="photo-picker">
      <div className="thumbs">
        {previews.map((src, i) => (
          <div className="thumb" key={src}>
            <img src={src} alt={`Foto ${i + 1}`} />
            <button
              type="button"
              className="thumb-remove"
              aria-label="Foto entfernen"
              onClick={() => onChange(files.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
        <label className="thumb thumb-add">
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? [])
              e.target.value = ''
              onChange([...files, ...picked])
            }}
          />
          <span>+ Foto</span>
        </label>
      </div>
    </div>
  )
}
