import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { PhotoPicker } from '../components/PhotoPicker'
import { uploadPhotos } from '../lib/photos'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/types'
import { useProfiles } from '../lib/useProfiles'

export function NewTicket() {
  const navigate = useNavigate()
  const { leads } = useProfiles()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { data, error } = await supabase
      .from('tickets')
      .insert({ title: title.trim(), description: description.trim(), assigned_to: assignedTo || null })
      .select('id')
      .single()
    if (error || !data) {
      setError(error?.message ?? 'Ticket konnte nicht angelegt werden.')
      setBusy(false)
      return
    }
    try {
      await uploadPhotos(data.id, files)
    } catch (err) {
      alert(`Ticket wurde angelegt, aber nicht alle Fotos konnten hochgeladen werden: ${(err as Error).message}`)
    }
    navigate(`/ticket/${data.id}`, { replace: true })
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h1>Neues QM-Ticket</h1>
      <label>
        Kurzbeschreibung *
        <input required maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Kratzer an Gehäuse Charge 4711" />
      </label>
      <label>
        Beschreibung
        <textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Was ist passiert? Wo? Wann?" />
      </label>
      <div className="field">
        <span>Fotos</span>
        <PhotoPicker files={files} onChange={setFiles} />
      </div>
      <label>
        Verantwortlicher Teamleiter
        <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
          <option value="">– später durch QM zuweisen –</option>
          {leads.map((p) => (
            <option key={p.id} value={p.id}>{displayName(p)}</option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" onClick={() => navigate(-1)} disabled={busy}>Abbrechen</button>
        <button className="primary" disabled={busy}>{busy ? 'Speichert…' : 'Ticket anlegen'}</button>
      </div>
    </form>
  )
}
