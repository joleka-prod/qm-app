// Fenster-Konstruktor: Datenmodell, Vorlagen und lokale Ablage (vorerst nur in diesem Browser)

export type Opening = 'fest' | 'dl' | 'dr' | 'k' | 'dkl' | 'dkr'

export const OPENING_LABEL: Record<Opening, string> = {
  fest: 'Festverglasung',
  dl: 'Dreh links',
  dr: 'Dreh rechts',
  k: 'Kipp',
  dkl: 'Dreh-Kipp links',
  dkr: 'Dreh-Kipp rechts',
}

export const OPENING_SHORT: Record<Opening, string> = { fest: 'F', dl: 'DL', dr: 'DR', k: 'K', dkl: 'DKL', dkr: 'DKR' }

export const OPENINGS = Object.keys(OPENING_LABEL) as Opening[]

export const MATERIALS = ['Kunststoff', 'Holz', 'Holz-Alu', 'Aluminium'] as const
export const GLAZINGS = ['2-fach Isolierglas', '3-fach Isolierglas', 'Sicherheitsglas (VSG)', 'Schallschutzglas', 'Ornamentglas'] as const

// Sonnenschutz zum Fenster
export type ShadeType = 'rollladen' | 'raffstore' | 'zip'

export const SHADE_LABEL: Record<ShadeType, string> = { rollladen: 'Rollladen', raffstore: 'Raffstore', zip: 'ZIP Screen' }
export const SHADE_TYPES = Object.keys(SHADE_LABEL) as ShadeType[]
export const SHADE_MOUNTINGS = ['Aufsatz', 'Vorbau', 'Unterputz'] as const
export const SHADE_DRIVES = ['Gurt', 'Kurbel', 'Motor', 'Funkmotor'] as const
// Bezeichnung des Behangs je Art
export const SHADE_HANGING_LABEL: Record<ShadeType, string> = { rollladen: 'Profil / Material', raffstore: 'Lamelle', zip: 'Stoff' }
export const SHADE_HANGING_HINT: Record<ShadeType, string> = {
  rollladen: 'z. B. Aluminium 37 mm',
  raffstore: 'z. B. 80 mm Flachlamelle, 90 mm Z-Lamelle',
  zip: 'z. B. Soltis 86, Serge 600',
}

export interface WindowShade {
  type: ShadeType
  mounting: string
  width: number
  height: number
  boxHeight: number
  drive: string
  side: 'links' | 'rechts'
  hanging: string
  color: string
  boxColor: string
  note: string
}

export function newShade(w: WindowDesign, type: ShadeType = 'rollladen'): WindowShade {
  return {
    type,
    mounting: type === 'rollladen' ? 'Aufsatz' : 'Vorbau',
    width: w.width,
    height: w.height,
    boxHeight: type === 'raffstore' ? 200 : 250,
    drive: 'Motor',
    side: 'rechts',
    hanging: '',
    color: '',
    boxColor: '',
    note: '',
  }
}

export function shadeSummary(s: WindowShade): string {
  return `${SHADE_LABEL[s.type]} ${s.mounting}, ${s.width} × ${s.height} mm, ${s.drive} ${s.side}`
}

export interface WindowDesign {
  id: string
  name: string
  quantity: number
  width: number
  height: number
  // Breiten der Flügelfelder in mm, Summe = Gesamtbreite
  columns: number[]
  openings: Opening[]
  // Oberlicht über die ganze Breite
  transom: { height: number; opening: Opening } | null
  material: string
  color: string
  glazing: string
  note: string
  // fehlt bei älteren gespeicherten Fenstern
  shade?: WindowShade | null
  updatedAt: string
}

export function newWindow(): WindowDesign {
  return {
    id: crypto.randomUUID(),
    name: '',
    quantity: 1,
    width: 1230,
    height: 1480,
    columns: [615, 615],
    openings: ['dkl', 'dkr'],
    transom: null,
    material: MATERIALS[0],
    color: 'Weiß',
    glazing: GLAZINGS[1],
    note: '',
    shade: null,
    updatedAt: new Date().toISOString(),
  }
}

// gleichmäßig aufteilen, Rest auf das letzte Feld
export function splitEven(width: number, count: number): number[] {
  const each = Math.floor(width / count)
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? width - each * (count - 1) : each))
}

export function windowSummary(w: WindowDesign): string {
  const parts = w.openings.map((o) => OPENING_SHORT[o]).join(' | ')
  return `${w.width} × ${w.height} mm · ${parts}${w.transom ? ` · Oberlicht ${OPENING_SHORT[w.transom.opening]}` : ''}${w.shade ? ` · ${SHADE_LABEL[w.shade.type]}` : ''}`
}

export function windowProblems(w: WindowDesign): string[] {
  const out: string[] = []
  if (w.width < 300 || w.height < 300) out.push('Breite und Höhe müssen mindestens 300 mm sein.')
  if (w.columns.some((c) => c < 250)) out.push('Jedes Feld muss mindestens 250 mm breit sein.')
  if (w.columns.reduce((a, b) => a + b, 0) !== w.width) out.push('Die Feldbreiten ergeben nicht die Gesamtbreite.')
  if (w.transom && (w.transom.height < 200 || w.height - w.transom.height < 300)) out.push('Oberlicht mindestens 200 mm, darunter mindestens 300 mm.')
  const sh = w.shade
  if (sh) {
    if (sh.width < 300 || sh.height < 300) out.push('Sonnenschutz: Breite und Höhe müssen mindestens 300 mm sein.')
    if (sh.boxHeight < 50 || sh.boxHeight > 600) out.push('Sonnenschutz: Kastenhöhe zwischen 50 und 600 mm.')
  }
  return out
}

const KEY = 'joleka-fenster'

export function loadWindows(): WindowDesign[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as WindowDesign[]
  } catch {
    return []
  }
}

export function storeWindows(list: WindowDesign[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}
