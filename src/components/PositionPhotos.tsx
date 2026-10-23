import type { TicketPhoto } from '../lib/types'
import { PhotoGallery } from './PhotoGallery'

interface Props {
  photos: TicketPhoto[]
  canAdd: boolean
  canDelete: (p: TicketPhoto) => boolean
  onAdd: (files: File[]) => void
  onDelete: (p: TicketPhoto) => void
}

// Fotos einer einzelnen Position. Ausgewählte Fotos werden sofort hochgeladen.
export function PositionPhotos({ photos, canAdd, canDelete, onAdd, onDelete }: Props) {
  if (photos.length === 0 && !canAdd) return null
  return (
    <div className="position-photos">
      {photos.length > 0 && <PhotoGallery photos={photos} canDelete={canDelete} onDelete={onDelete} />}
      {canAdd && (
        <label className="link small add-position-photo">
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? [])
              e.target.value = ''
              if (picked.length > 0) onAdd(picked)
            }}
          />
          + Foto zur Position
        </label>
      )}
    </div>
  )
}
