import { useState, type FormEvent } from 'react'
import { useArticles, type Article } from '../lib/articles'
import { supabase } from '../lib/supabase'
import { formatEuro } from '../lib/types'

const UNITS = ['Stk', 'Std', 'm', 'm²', 'lfm', 'km', 'pauschal']

type Form = { id?: number; article_number: string; description: string; unit: string; price: string; active: boolean }

const emptyForm: Form = { article_number: '', description: '', unit: 'Stk', price: '', active: true }

// "12,50" / "1.234,5" / "12.5" -> 12.5; leer -> null; ungültig -> NaN
function parsePrice(s: string) {
  const v = s.trim().replace(/\s|€/g, '')
  if (!v) return null
  const normalized = v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v
  return /^\d+(\.\d{0,2})?$/.test(normalized) ? Number(normalized) : NaN
}

// Artikel / wiederkehrende Positionen pflegen (nur Admin)
export function Articles() {
  const { articles, reload } = useArticles(true)
  const [form, setForm] = useState<Form | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function edit(a: Article) {
    setError('')
    setForm({
      id: a.id,
      article_number: a.article_number,
      description: a.description,
      unit: a.unit,
      price: a.price == null ? '' : a.price.toFixed(2).replace('.', ','),
      active: a.active,
    })
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    const price = parsePrice(form.price)
    if (Number.isNaN(price)) return setError('Bitte den Preis als Zahl eingeben, z. B. 49,90')
    setBusy(true)
    setError('')
    const row = {
      article_number: form.article_number.trim(),
      description: form.description.trim(),
      unit: form.unit.trim() || 'Stk',
      price,
      active: form.active,
    }
    const { error } = form.id
      ? await supabase.from('articles').update(row).eq('id', form.id)
      : await supabase.from('articles').insert(row)
    if (error) {
      setError(/articles_number_unique/.test(error.message) ? 'Diese Artikelnummer gibt es schon.' : error.message)
    } else {
      setForm(null)
      await reload()
    }
    setBusy(false)
  }

  const q = query.trim().toLowerCase()
  const visible = articles.filter(
    (a) => !q || a.article_number.toLowerCase().includes(q) || a.description.toLowerCase().includes(q),
  )

  const editor = form && (
    <form className="card form" onSubmit={save}>
      <h2>{form.id ? 'Artikel bearbeiten' : 'Neuer Artikel'}</h2>
      <div className="row">
        <label>
          Artikelnummer
          <input maxLength={30} value={form.article_number} onChange={(e) => setForm({ ...form, article_number: e.target.value })} />
        </label>
        <label>
          Einheit *
          <input required list="article-units" maxLength={20} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          <datalist id="article-units">
            {UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </label>
        <label>
          Einzelpreis € (netto)
          <input inputMode="decimal" placeholder="0,00" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        </label>
      </div>
      <label>
        Beschreibung *
        <textarea
          required
          rows={3}
          maxLength={2000}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Text, der in die Position übernommen wird"
        />
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
        Aktiv (in Aufträgen auswählbar)
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" onClick={() => setForm(null)} disabled={busy}>Abbrechen</button>
        <button className="primary" disabled={busy}>{busy ? 'Speichert…' : 'Speichern'}</button>
      </div>
    </form>
  )

  return (
    <div>
      <div className="page-head">
        <h1>Artikel</h1>
        {!form && (
          <button className="primary" onClick={() => { setError(''); setForm({ ...emptyForm }) }}>
            + Neuer Artikel
          </button>
        )}
      </div>
      <p className="muted small">
        Wiederkehrende Positionen mit Preis. Beim Anlegen eines Auftrags können sie unter „Positionen“ ausgewählt werden.
        Einheit und Preis werden dann für die Berechnung übernommen.
      </p>
      {form && !form.id && editor}
      <div className="filters">
        <input type="search" placeholder="Artikel suchen…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {visible.length === 0 ? (
        <p className="muted">{articles.length === 0 ? 'Noch keine Artikel angelegt.' : 'Keine Artikel gefunden.'}</p>
      ) : (
        <ul className="article-list">
          {visible.map((a) =>
            form?.id === a.id ? (
              <li key={a.id}>{editor}</li>
            ) : (
              <li key={a.id} className={`card article-row ${a.active ? '' : 'inactive'}`}>
                <div>
                  <div className="ticket-title">
                    {a.article_number && <span className="ticket-no">{a.article_number} </span>}
                    <span className="pre">{a.description}</span>
                  </div>
                  <div className="small muted">
                    {a.unit}
                    {!a.active && ' · nicht aktiv'}
                  </div>
                </div>
                <div className="user-controls">
                  <span className="article-price">{formatEuro(a.price)}</span>
                  <button onClick={() => edit(a)} disabled={busy}>Bearbeiten</button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  )
}
