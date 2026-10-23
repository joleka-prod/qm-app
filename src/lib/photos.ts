import imageCompression from 'browser-image-compression'
import { supabase } from './supabase'

const BUCKET = 'ticket-photos'

// Handyfotos werden vor dem Upload auf ca. 0,5 MB / 1920 px verkleinert.
async function compress(file: File) {
  return imageCompression(file, {
    maxSizeMB: 0.5,
    maxWidthOrHeight: 1920,
    useWebWorker: true,
    fileType: 'image/jpeg',
  })
}

export async function uploadPhotos(ticketId: number, files: File[], positionId: number | null = null) {
  for (const file of files) {
    const small = await compress(file)
    const path = `${ticketId}/${crypto.randomUUID()}.jpg`
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, small, { contentType: 'image/jpeg' })
    if (upErr) throw upErr
    const { error: dbErr } = await supabase
      .from('ticket_photos')
      .insert({ ticket_id: ticketId, storage_path: path, position_id: positionId })
    if (dbErr) throw dbErr
  }
}

export async function uploadSignature(ticketId: number, png: Blob) {
  const path = `${ticketId}/unterschrift-${crypto.randomUUID()}.png`
  const { error } = await supabase.storage.from(BUCKET).upload(path, png, { contentType: 'image/png' })
  if (error) throw error
  return path
}

export async function signedUrls(paths: string[]) {
  if (paths.length === 0) return {}
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 60 * 60)
  if (error) throw error
  const out: Record<string, string> = {}
  for (const item of data) {
    if (item.path && item.signedUrl) out[item.path] = item.signedUrl
  }
  return out
}

export async function deletePhoto(id: number, path: string) {
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw error
  const { error: dbErr } = await supabase.from('ticket_photos').delete().eq('id', id)
  if (dbErr) throw dbErr
}
