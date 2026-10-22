import { useEffect, useState } from 'react'
import { signedUrls } from '../lib/photos'
import type { TicketPhoto } from '../lib/types'

interface Props {
  photos: TicketPhoto[]
  canDelete: (p: TicketPhoto) => boolean
  onDelete: (p: TicketPhoto) => void
}

export function PhotoGallery({ photos, canDelete, onDelete }: Props) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    signedUrls(photos.map((p) => p.storage_path)).then(setUrls).catch(() => setUrls({}))
  }, [photos])

  if (photos.length === 0) return <p className="muted">Keine Fotos.</p>

  return (
    <>
      <div className="thumbs">
        {photos.map((p) => (
          <div className="thumb" key={p.id}>
            {urls[p.storage_path] ? (
              <img src={urls[p.storage_path]} alt="Foto" onClick={() => setOpen(urls[p.storage_path])} />
            ) : (
              <div className="thumb-loading" />
            )}
            {canDelete(p) && (
              <button
                type="button"
                className="thumb-remove"
                aria-label="Foto löschen"
                onClick={() => {
                  if (confirm('Foto wirklich löschen?')) onDelete(p)
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      {open && (
        <div className="lightbox" onClick={() => setOpen(null)}>
          <img src={open} alt="Foto groß" />
        </div>
      )}
    </>
  )
}
