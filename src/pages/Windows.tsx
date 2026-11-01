import { useState } from 'react'
import { WindowDrawing } from '../components/WindowDrawing'
import {
  GLAZINGS,
  MATERIALS,
  OPENINGS,
  OPENING_LABEL,
  OPENING_SHORT,
  SHADE_DRIVES,
  SHADE_HANGING_HINT,
  SHADE_HANGING_LABEL,
  SHADE_LABEL,
  SHADE_MOUNTINGS,
  SHADE_TYPES,
  loadWindows,
  newShade,
  newWindow,
  splitEven,
  storeWindows,
  windowProblems,
  windowSummary,
  type Opening,
  type ShadeType,
  type WindowDesign,
  type WindowShade,
} from '../lib/windows'

// Fenster konstruieren (nur Admin): Maße, Teilung, Oberlicht, Öffnungsarten, Zeichnung zum Drucken
export function Windows() {
  const [saved, setSaved] = useState<WindowDesign[]>(loadWindows)
  const [w, setW] = useState<WindowDesign>(() => saved[0] ?? newWindow())
  const [field, setField] = useState<number>(0)
  const [notice, setNotice] = useState('')

  const problems = windowProblems(w)
  const isSaved = saved.some((x) => x.id === w.id)

  function update(patch: Partial<WindowDesign>) {
    setW((prev) => ({ ...prev, ...patch }))
    setNotice('')
  }

  function setWidth(width: number) {
    update({ width, columns: splitEven(width, w.columns.length) })
  }

  function setColumnCount(n: number) {
    const openings = Array.from({ length: n }, (_, i): Opening => (n === 1 ? 'dkr' : i === 0 ? 'dkl' : i === n - 1 ? 'dkr' : 'fest'))
    update({ columns: splitEven(w.width, n), openings })
    if (field >= n) setField(0)
  }

  // Feldbreite ändern, das letzte Feld gleicht aus
  function setColumn(i: number, value: number) {
    const columns = [...w.columns]
    columns[i] = value
    const rest = w.width - columns.slice(0, -1).reduce((a, b) => a + b, 0)
    columns[columns.length - 1] = rest
    update({ columns })
  }

  function setOpening(o: Opening) {
    if (field === -1 && w.transom) update({ transom: { ...w.transom, opening: o } })
    else update({ openings: w.openings.map((x, i) => (i === field ? o : x)) })
  }

  function toggleTransom(on: boolean) {
    update({ transom: on ? { height: Math.round(w.height * 0.3), opening: 'k' } : null })
    setField(on ? -1 : 0)
  }

  function setShadeType(type: ShadeType | null) {
    if (!type) update({ shade: null })
    else if (w.shade) update({ shade: { ...w.shade, type } })
    else update({ shade: newShade(w, type) })
  }

  function updateShade(patch: Partial<WindowShade>) {
    if (w.shade) update({ shade: { ...w.shade, ...patch } })
  }

  function save() {
    const item = { ...w, name: w.name.trim() || `Fenster ${saved.length + 1}`, updatedAt: new Date().toISOString() }
    const list = isSaved ? saved.map((x) => (x.id === item.id ? item : x)) : [item, ...saved]
    setW(item)
    setSaved(list)
    setNotice(storeWindows(list) ? 'Gespeichert.' : 'Speichern in diesem Browser nicht möglich.')
  }

  function open(item: WindowDesign) {
    setW(item)
    setField(0)
    setNotice('')
  }

  function copy() {
    setW({ ...w, id: crypto.randomUUID(), name: `${w.name || 'Fenster'} (Kopie)` })
    setNotice('Kopie erstellt, noch nicht gespeichert.')
  }

  function remove() {
    if (!confirm(`„${w.name}“ löschen?`)) return
    const list = saved.filter((x) => x.id !== w.id)
    setSaved(list)
    storeWindows(list)
    setW(list[0] ?? newWindow())
    setField(0)
  }

  const current: Opening = field === -1 && w.transom ? w.transom.opening : w.openings[field] ?? w.openings[0]

  return (
    <div className="window-page">
      <div className="page-head no-print">
        <h1>Fenster konstruieren</h1>
        <div className="card-head-actions">
          <button type="button" onClick={() => open(newWindow())}>+ Neues Fenster</button>
          <button type="button" onClick={() => window.print()}>Drucken</button>
        </div>
      </div>

      <div className="window-layout">
        <section className="card window-preview">
          <h2 className="print-only">{w.name || 'Fenster'}{w.quantity > 1 ? ` · ${w.quantity} Stück` : ''}</h2>
          <WindowDrawing w={w} selected={field} onSelect={setField} />
          <p className="small muted no-print">Ansicht von innen. Feld antippen, um die Öffnungsart zu wählen.</p>
          <table className="window-spec">
            <tbody>
              <tr><th>Maße</th><td>{w.width} × {w.height} mm{w.quantity > 1 ? `, ${w.quantity} Stück` : ''}</td></tr>
              <tr>
                <th>Felder</th>
                <td>
                  {w.transom && <>Oberlicht {w.transom.height} mm: {OPENING_LABEL[w.transom.opening]}<br /></>}
                  {w.columns.map((c, i) => `${c} mm ${OPENING_LABEL[w.openings[i]]}`).join(' · ')}
                </td>
              </tr>
              <tr><th>Material</th><td>{w.material}{w.color && `, ${w.color}`}</td></tr>
              <tr><th>Verglasung</th><td>{w.glazing}</td></tr>
              {w.shade && (
                <tr>
                  <th>Sonnenschutz</th>
                  <td>
                    {SHADE_LABEL[w.shade.type]} {w.shade.mounting}, {w.shade.width} × {w.shade.height} mm, Kasten {w.shade.boxHeight} mm
                    <br />Antrieb {w.shade.drive}, Bedienseite {w.shade.side}
                    {w.shade.hanging && <><br />{SHADE_HANGING_LABEL[w.shade.type]}: {w.shade.hanging}</>}
                    {(w.shade.color || w.shade.boxColor) && (
                      <><br />Farbe {[w.shade.color && `Behang ${w.shade.color}`, w.shade.boxColor && `Kasten/Schienen ${w.shade.boxColor}`].filter(Boolean).join(', ')}</>
                    )}
                    {w.shade.note && <><br /><span className="pre">{w.shade.note}</span></>}
                  </td>
                </tr>
              )}
              {w.note && <tr><th>Hinweis</th><td className="pre">{w.note}</td></tr>}
            </tbody>
          </table>
        </section>

        <section className="card form no-print">
          <label>
            Bezeichnung
            <input value={w.name} placeholder="z. B. Küche EG" onChange={(e) => update({ name: e.target.value })} />
          </label>
          <div className="window-row">
            <label>
              Breite (mm)
              <input type="number" inputMode="numeric" min={300} step={10} value={w.width} onChange={(e) => setWidth(Number(e.target.value) || 0)} />
            </label>
            <label>
              Höhe (mm)
              <input type="number" inputMode="numeric" min={300} step={10} value={w.height} onChange={(e) => update({ height: Number(e.target.value) || 0 })} />
            </label>
            <label>
              Stück
              <input type="number" inputMode="numeric" min={1} value={w.quantity} onChange={(e) => update({ quantity: Math.max(1, Number(e.target.value) || 1) })} />
            </label>
          </div>

          <div className="field">
            Anzahl Flügel
            <div className="chip-row">
              {[1, 2, 3, 4].map((n) => (
                <button type="button" key={n} className={w.columns.length === n ? 'chip active' : 'chip'} onClick={() => setColumnCount(n)}>
                  {n}-teilig
                </button>
              ))}
            </div>
          </div>
          {w.columns.length > 1 && (
            <div className="window-row">
              {w.columns.map((c, i) => (
                <label key={i}>
                  Feld {i + 1} (mm)
                  <input
                    type="number"
                    inputMode="numeric"
                    step={10}
                    value={c}
                    readOnly={i === w.columns.length - 1}
                    title={i === w.columns.length - 1 ? 'Ergibt sich aus der Gesamtbreite' : undefined}
                    onChange={(e) => setColumn(i, Number(e.target.value) || 0)}
                  />
                </label>
              ))}
            </div>
          )}

          <label className="checkbox-row">
            <input type="checkbox" checked={!!w.transom} onChange={(e) => toggleTransom(e.target.checked)} /> Oberlicht
          </label>
          {w.transom && (
            <label>
              Höhe Oberlicht (mm)
              <input
                type="number"
                inputMode="numeric"
                step={10}
                value={w.transom.height}
                onChange={(e) => update({ transom: { ...w.transom!, height: Number(e.target.value) || 0 } })}
              />
            </label>
          )}

          <div className="field">
            Öffnungsart
            <div className="chip-row">
              {w.transom && (
                <button type="button" className={field === -1 ? 'chip active' : 'chip'} onClick={() => setField(-1)}>Oberlicht</button>
              )}
              {w.columns.map((_, i) => (
                <button type="button" key={i} className={field === i ? 'chip active' : 'chip'} onClick={() => setField(i)}>
                  Feld {i + 1}
                </button>
              ))}
            </div>
            <div className="chip-row">
              {OPENINGS.filter((o) => field !== -1 || o === 'fest' || o === 'k').map((o) => (
                <button type="button" key={o} className={current === o ? 'chip active' : 'chip'} onClick={() => setOpening(o)}>
                  {OPENING_SHORT[o]} · {OPENING_LABEL[o]}
                </button>
              ))}
            </div>
          </div>

          <div className="window-row">
            <label>
              Material
              <select value={w.material} onChange={(e) => update({ material: e.target.value })}>
                {MATERIALS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
            <label>
              Farbe
              <input value={w.color} onChange={(e) => update({ color: e.target.value })} />
            </label>
          </div>
          <label>
            Verglasung
            <select value={w.glazing} onChange={(e) => update({ glazing: e.target.value })}>
              {GLAZINGS.map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>
          <label>
            Hinweis
            <textarea rows={2} value={w.note} onChange={(e) => update({ note: e.target.value })} />
          </label>

          <div className="field">
            Sonnenschutz
            <div className="chip-row">
              <button type="button" className={!w.shade ? 'chip active' : 'chip'} onClick={() => setShadeType(null)}>keiner</button>
              {SHADE_TYPES.map((t) => (
                <button type="button" key={t} className={w.shade?.type === t ? 'chip active' : 'chip'} onClick={() => setShadeType(t)}>
                  {SHADE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
          {w.shade && (
            <>
              <div className="window-row">
                <label>
                  Einbau
                  <select value={w.shade.mounting} onChange={(e) => updateShade({ mounting: e.target.value })}>
                    {SHADE_MOUNTINGS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </label>
                <label>
                  Antrieb
                  <select value={w.shade.drive} onChange={(e) => updateShade({ drive: e.target.value })}>
                    {SHADE_DRIVES.map((d) => <option key={d}>{d}</option>)}
                  </select>
                </label>
                <label>
                  Bedienseite
                  <select value={w.shade.side} onChange={(e) => updateShade({ side: e.target.value as WindowShade['side'] })}>
                    <option value="links">links</option>
                    <option value="rechts">rechts</option>
                  </select>
                </label>
              </div>
              <div className="window-row">
                <label>
                  Breite (mm)
                  <input type="number" inputMode="numeric" step={10} value={w.shade.width} onChange={(e) => updateShade({ width: Number(e.target.value) || 0 })} />
                </label>
                <label>
                  Höhe (mm)
                  <input type="number" inputMode="numeric" step={10} value={w.shade.height} onChange={(e) => updateShade({ height: Number(e.target.value) || 0 })} />
                </label>
                <label>
                  Kastenhöhe (mm)
                  <input type="number" inputMode="numeric" step={5} value={w.shade.boxHeight} onChange={(e) => updateShade({ boxHeight: Number(e.target.value) || 0 })} />
                </label>
              </div>
              {(w.shade.width !== w.width || w.shade.height !== w.height) && (
                <button type="button" onClick={() => updateShade({ width: w.width, height: w.height })}>
                  Maße vom Fenster übernehmen ({w.width} × {w.height} mm)
                </button>
              )}
              <label>
                {SHADE_HANGING_LABEL[w.shade.type]}
                <input value={w.shade.hanging} placeholder={SHADE_HANGING_HINT[w.shade.type]} onChange={(e) => updateShade({ hanging: e.target.value })} />
              </label>
              <div className="window-row">
                <label>
                  Farbe Behang
                  <input value={w.shade.color} onChange={(e) => updateShade({ color: e.target.value })} />
                </label>
                <label>
                  Farbe Kasten / Schienen
                  <input value={w.shade.boxColor} onChange={(e) => updateShade({ boxColor: e.target.value })} />
                </label>
              </div>
              <label>
                Bemerkung Sonnenschutz
                <textarea rows={2} value={w.shade.note} onChange={(e) => updateShade({ note: e.target.value })} />
              </label>
            </>
          )}

          {problems.map((p) => <p key={p} className="error">{p}</p>)}
          {notice && <p className="info">{notice}</p>}
          <div className="actions">
            {isSaved && <button type="button" className="danger" onClick={remove}>Löschen</button>}
            {isSaved && <button type="button" onClick={copy}>Kopieren</button>}
            <button type="button" className="primary" disabled={problems.length > 0} onClick={save}>Speichern</button>
          </div>
        </section>
      </div>

      {saved.length > 0 && (
        <section className="card no-print">
          <h2>Gespeicherte Fenster</h2>
          <ul className="window-list">
            {saved.map((x) => (
              <li key={x.id}>
                <button type="button" className={x.id === w.id ? 'window-item active' : 'window-item'} onClick={() => open(x)}>
                  <WindowDrawing w={x} />
                  <span>
                    <strong>{x.name}</strong>{x.quantity > 1 && ` · ${x.quantity} Stück`}
                    <span className="small muted"><br />{windowSummary(x)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="small muted">Die Fenster werden vorerst nur in diesem Browser gespeichert.</p>
        </section>
      )}
    </div>
  )
}
