// Personal nach dem Vorbild der Ninox-Mitarbeiterdatenbank (Fabian, 2026-10-26):
// gleiche Reiter, Abschnitte, Felder und Untertabellen. Der einmalige Ninox-Import ist abgeschlossen.

export type FieldType = 'text' | 'number' | 'money' | 'date' | 'datetime' | 'choice' | 'yesno' | 'status' | 'textarea' | 'file'

export interface Field {
  key: string
  label: string
  type: FieldType
  // Vorschläge bei Auswahlfeldern (eigene Werte bleiben möglich)
  options?: string[]
  wide?: boolean
  // Einheit hinter der Zahl, z. B. "Tage"
  unit?: string
}

export interface SubTable {
  kind: string
  title: string
  columns: Field[]
  // Spalte zum Sortieren (absteigend, neueste oben)
  sortBy?: string
}

export interface Section {
  title?: string
  fields?: Field[]
  tables?: string[]
  // berechnete Anzeige (Alter, Betriebszugehörigkeit)
  computed?: ('age' | 'seniority')[]
}

export interface Tab {
  key: string
  title: string
  sections: Section[]
}

export const STATUS = ['Aktiv', 'nicht aktiv', 'Langzeitkrank'] as const

export const MAIN_FIELDS: Field[] = [
  { key: 'personnel_number', label: 'Personalnummer', type: 'text' },
  { key: 'status', label: 'Status', type: 'status' },
  { key: 'tax_class', label: 'Lohnsteuerklasse', type: 'choice', options: ['1', '2', '3', '4', '5', '6'] },
  { key: 'salutation', label: 'Anrede', type: 'choice', options: ['Herr', 'Frau', 'Divers'] },
  { key: 'first_name', label: 'Vorname', type: 'text' },
  { key: 'last_name', label: 'Nachname', type: 'text' },
  { key: 'mother_tongue', label: 'Muttersprache', type: 'choice', options: ['deutsch'] },
  { key: 'birth_date', label: 'Geburtsdatum', type: 'date' },
  { key: 'marital_status', label: 'Familienstand', type: 'choice', options: ['Ledig', 'Verheiratet', 'Geschieden', 'Verwitwet', 'Eingetragene Lebenspartnerschaft'] },
  { key: 'street', label: 'Straße', type: 'text', wide: true },
  { key: 'house_no', label: 'Hausnummer', type: 'text' },
  { key: 'zip', label: 'PLZ', type: 'text' },
  { key: 'city', label: 'Ort', type: 'text', wide: true },
  { key: 'phone_private', label: 'Festnetz privat', type: 'text', wide: true },
  { key: 'mobile_private', label: 'Mobiltelefon privat', type: 'text', wide: true },
  { key: 'email_private', label: 'E-Mail privat', type: 'text', wide: true },
  { key: 'vacation_days', label: 'Urlaubsanspruch', type: 'number', unit: 'Tage' },
  { key: 'entry_date', label: 'Firmeneintritt', type: 'date' },
  { key: 'department', label: 'Abteilung', type: 'choice', options: ['Geschäftsführung'] },
  { key: 'specific_experience', label: 'Spezifische Berufserfahrung', type: 'text' },
  { key: 'vl_payment', label: 'VL Zahlung?', type: 'yesno' },
  { key: 'residence_title', label: 'Aufenthaltstitel', type: 'choice', options: [] },
  { key: 'residence_valid_until', label: 'Aufenthaltstitel gültig bis:', type: 'date' },
  // Abrechnungsrelevante Angaben (Fabian, 2026-10-27)
  { key: 'birth_name', label: 'Geburtsname', type: 'text' },
  { key: 'birth_place', label: 'Geburtsort', type: 'text' },
  { key: 'nationality', label: 'Staatsangehörigkeit', type: 'choice', options: ['deutsch'] },
  { key: 'exit_date', label: 'Austrittsdatum', type: 'date' },
  { key: 'job_title', label: 'Tätigkeit / Berufsbezeichnung', type: 'text', wide: true },
  { key: 'employment_type', label: 'Beschäftigungsart', type: 'choice', options: ['Vollzeit', 'Teilzeit', 'Minijob', 'Auszubildende(r)', 'Werkstudent(in)', 'Aushilfe'] },
  { key: 'weekly_hours', label: 'Wochenarbeitszeit', type: 'number', unit: 'Std.' },
  { key: 'probation_end', label: 'Probezeit bis', type: 'date' },
  { key: 'contract_end', label: 'Befristet bis', type: 'date' },
  { key: 'wage_type', label: 'Vergütung', type: 'choice', options: ['Stundenlohn', 'Monatsgehalt'] },
  { key: 'tax_id', label: 'Steuer-ID', type: 'text' },
  { key: 'church_tax', label: 'Konfession (Kirchensteuer)', type: 'choice', options: ['keine', 'evangelisch', 'römisch-katholisch', 'andere'] },
  { key: 'child_allowance', label: 'Kinderfreibeträge', type: 'number' },
  { key: 'social_security_no', label: 'Sozialversicherungsnummer', type: 'text' },
  { key: 'health_insurance', label: 'Krankenkasse', type: 'text', wide: true },
  { key: 'insurance_type', label: 'Krankenversicherung', type: 'choice', options: ['gesetzlich', 'privat'] },
  { key: 'disability', label: 'Schwerbehinderung', type: 'choice', options: ['nein', 'ja (GdB ab 50)', 'gleichgestellt'] },
  { key: 'iban', label: 'IBAN', type: 'text', wide: true },
  { key: 'bic', label: 'BIC', type: 'text' },
  { key: 'account_holder', label: 'Kontoinhaber', type: 'text', wide: true },
]

const F = Object.fromEntries(MAIN_FIELDS.map((f) => [f.key, f])) as Record<string, Field>
const pick = (...keys: string[]) => keys.map((k) => F[k])

export const SUBTABLES: SubTable[] = [
  {
    kind: 'kinder', title: 'Kinder', sortBy: 'birth_date',
    columns: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'birth_date', label: 'Geburtsdatum', type: 'date' },
    ],
  },
  {
    kind: 'a1', title: 'A1 Bescheinigung für Luxemburg', sortBy: 'valid_until',
    columns: [
      { key: 'nr', label: 'Nr', type: 'number' },
      { key: 'valid_until', label: 'Gültig bis:', type: 'date' },
      { key: 'antrag', label: 'Antrag', type: 'file' },
      { key: 'bescheinigung', label: 'Bescheinigung', type: 'file' },
      { key: 'entsendung', label: 'Entsendung', type: 'file' },
      { key: 'belehrung', label: 'Belehrung', type: 'file' },
    ],
  },
  {
    kind: 'lohn', title: 'Lohn und Gehalt', sortBy: 'from',
    columns: [
      { key: 'from', label: 'Ab Datum', type: 'date' },
      { key: 'wage', label: 'Stundenlohn / Gehalt', type: 'money' },
      { key: 'reason', label: 'Grund', type: 'text', wide: true },
    ],
  },
  {
    kind: 'nebentaetigkeit', title: 'Nebentätigkeit', sortBy: 'start',
    columns: [
      { key: 'nr', label: 'Nr', type: 'number' },
      { key: 'start', label: 'Start der Nebentätigkeit', type: 'date' },
      { key: 'end', label: 'Ende der Nebentätigkeit', type: 'date' },
      { key: 'description', label: 'Beschreibung', type: 'text', wide: true },
    ],
  },
  {
    kind: 'praemie', title: 'Prämienzahlung', sortBy: 'date',
    columns: [
      { key: 'date', label: 'Datum', type: 'date' },
      { key: 'amount', label: 'Betrag', type: 'money' },
      { key: 'reason', label: 'Grund', type: 'text', wide: true },
    ],
  },
  {
    kind: 'gespraech', title: 'Mitarbeitergespräche', sortBy: 'at',
    columns: [
      { key: 'at', label: 'Datum + Uhrzeit', type: 'datetime' },
      { key: 'persons', label: 'Beteiligte Personen', type: 'text', wide: true },
      { key: 'recurring', label: 'Wiederkehrendes Mitarbeitergespräch', type: 'text' },
    ],
  },
  {
    kind: 'darlehen', title: 'Mitarbeiterdarlehen', sortBy: 'paid_out',
    columns: [
      { key: 'paid_out', label: 'Ausgezahlt am', type: 'date' },
      { key: 'amount', label: 'Darlehensbetrag', type: 'money' },
      { key: 'repaid', label: 'Zurückgezahlt am', type: 'date' },
    ],
  },
  {
    kind: 'vorschuss', title: 'Lohnvorschuss', sortBy: 'date',
    columns: [
      { key: 'date', label: 'Datum', type: 'date' },
      { key: 'payment', label: 'Zahlung', type: 'text' },
      { key: 'amount', label: 'Betrag', type: 'money' },
      { key: 'transfer_day', label: 'Überweisungstag', type: 'text' },
    ],
  },
  {
    kind: 'direktversicherung', title: 'Direktversicherung', sortBy: 'contract_date',
    columns: [
      { key: 'contract_date', label: 'Vertragsdatum', type: 'date' },
      { key: 'insurance', label: 'Versicherung', type: 'text', wide: true },
      { key: 'monthly_rate', label: 'Monatliche Rate (Gesamt)', type: 'money' },
      { key: 'employer_share', label: 'Arbeitgeberanteil', type: 'money' },
    ],
  },
  {
    kind: 'schulung', title: 'Schulungen', sortBy: 'date',
    columns: [
      { key: 'date', label: 'Datum von', type: 'date' },
      { key: 'content', label: 'Schulungsinhalt', type: 'text', wide: true },
      { key: 'cost', label: 'Schulungskosten', type: 'money' },
    ],
  },
  {
    kind: 'deutschkurs', title: 'Deutschkurse', sortBy: 'date',
    columns: [
      { key: 'date', label: 'Unterrichtstermin', type: 'text' },
      { key: 'course', label: 'Kurs', type: 'text', wide: true },
      { key: 'place', label: 'Ort', type: 'text' },
      { key: 'cost', label: 'Kosten', type: 'money' },
    ],
  },
  {
    kind: 'schuhe', title: 'Sicherheitsschuhe', sortBy: 'date',
    columns: [
      { key: 'date', label: 'Datum', type: 'date' },
      { key: 'amount', label: 'Betrag', type: 'number' },
      { key: 'size', label: 'Schuhgröße laut Rechnung', type: 'text', wide: true },
    ],
  },
  {
    kind: 'kleidung', title: 'Arbeitskleidung', sortBy: 'date',
    columns: [
      { key: 'date', label: 'Datum', type: 'date' },
      { key: 'qty', label: 'Menge', type: 'number' },
      { key: 'article', label: 'Artikel', type: 'text' },
      { key: 'unit_price', label: 'EK pro Stück', type: 'money' },
      { key: 'total', label: 'Gesamt EK ohne MwSt', type: 'money' },
    ],
  },
  {
    kind: 'kfz', title: 'KFZ/Fahrrad', sortBy: 'lease_start',
    columns: [
      { key: 'lease_start', label: 'Leasingbeginn', type: 'date' },
      { key: 'lease_end', label: 'Leasingende', type: 'date' },
      { key: 'monthly_cost', label: 'Leasingkosten pro Monat', type: 'money' },
      { key: 'vehicle', label: 'Fahrzeug', type: 'text' },
      { key: 'plate', label: 'Kennzeichen', type: 'text' },
    ],
  },
  {
    kind: 'unfall', title: 'Arbeitsunfälle', sortBy: 'date',
    columns: [
      { key: 'date', label: 'Datum', type: 'date' },
      { key: 'sick_days', label: 'Krankheitstage', type: 'number' },
      { key: 'what', label: 'Was ist passiert?', type: 'textarea', wide: true },
    ],
  },
  {
    kind: 'krankheit', title: 'Krankheitstage (manuell erfasst)', sortBy: 'year',
    columns: [
      { key: 'year', label: 'Jahr', type: 'number' },
      { key: 'days_total', label: 'Fehltage gesamt', type: 'number' },
      { key: 'accident_days', label: 'Davon Unfalltage', type: 'number' },
    ],
  },
  {
    kind: 'reha', title: 'Reha/Kur', sortBy: 'start',
    columns: [
      { key: 'type', label: 'Auswahl', type: 'choice', options: ['Reha', 'Kur'] },
      { key: 'start', label: 'Datum Anfang', type: 'date' },
      { key: 'end', label: 'Datum Ende', type: 'date' },
    ],
  },
]

export const SUBTABLE = Object.fromEntries(SUBTABLES.map((t) => [t.kind, t])) as Record<string, SubTable>

export const TABS: Tab[] = [
  {
    key: 'mitarbeiter',
    title: 'Stammdaten',
    sections: [
      { fields: pick('personnel_number', 'status', 'tax_class') },
      { fields: pick('salutation', 'first_name', 'last_name', 'mother_tongue') },
      { fields: pick('birth_date', 'marital_status', 'birth_name', 'birth_place', 'nationality'), computed: ['age'] },
      { tables: ['kinder'] },
      { title: 'Anschrift', fields: pick('street', 'house_no', 'zip', 'city', 'phone_private', 'mobile_private', 'email_private') },
      {
        title: 'Vertragsdaten',
        fields: pick('vacation_days', 'entry_date', 'exit_date', 'department', 'job_title', 'specific_experience', 'employment_type', 'weekly_hours', 'wage_type', 'probation_end', 'contract_end'),
        computed: ['seniority'],
      },
      { title: 'Lohnabrechnung', fields: pick('tax_id', 'church_tax', 'child_allowance', 'social_security_no', 'health_insurance', 'insurance_type', 'disability') },
      { title: 'Bankverbindung', fields: pick('iban', 'bic', 'account_holder') },
      { title: 'Vermögenswirksame Leistungen (VL)', fields: pick('vl_payment') },
      { title: 'Arbeits- und Aufenthaltsgenehmigungen', fields: pick('residence_title', 'residence_valid_until'), tables: ['a1'] },
    ],
  },
  {
    key: 'logbuch',
    title: 'Logbuch',
    sections: [
      { title: 'Lohn und Gehalt', tables: ['lohn'] },
      { title: 'Nebentätigkeiten', tables: ['nebentaetigkeit'] },
      { title: 'Prämienzahlungen', tables: ['praemie'] },
      { title: 'Mitarbeitergespräche', tables: ['gespraech'] },
      { title: 'Mitarbeiterdarlehen', tables: ['darlehen'] },
      { title: 'Lohnvorschuss', tables: ['vorschuss'] },
      { title: 'Direktversicherung', tables: ['direktversicherung'] },
    ],
  },
  { key: 'schulungen', title: 'Schulungen', sections: [{ tables: ['schulung', 'deutschkurs'] }] },
  { key: 'kleidung', title: 'Kleidung/KFZ', sections: [{ tables: ['schuhe', 'kleidung', 'kfz'] }] },
  { key: 'fehlzeiten', title: 'Fehlzeiten', sections: [{ tables: ['unfall', 'krankheit', 'reha'] }] },
  { key: 'lohnkonzept', title: 'Lohnkonzept', sections: [] },
]

// ---------------------------------------------------------------- Lohnkonzept

export interface WageItem {
  key: string
  label: string
  amount: number
}

export interface WageGroup {
  title: string
  // nur ein Punkt der Gruppe wählbar
  single?: boolean
  items: WageItem[]
  // zweite Zeile nach "oder:" (schließt die erste aus)
  alternative?: WageItem[]
}

export const WAGE_GROUPS: WageGroup[] = [
  {
    title: 'Ausbildung',
    items: [
      { key: 'ohne_ausbildung', label: 'Ohne Berufsausbildung', amount: 13 },
      { key: 'deutsch_sprechen', label: 'Deutsch sprechen und verstehen', amount: 1 },
      { key: 'deutsch_schreiben', label: 'Deutsch lesen und schreiben', amount: 1 },
    ],
    alternative: [{ key: 'ihk_ausbildung', label: 'IHK / HWK Berufsausbildung Schreiner oder Gleichwertig', amount: 16 }],
  },
  {
    title: 'Arbeitsweise (1 Punkt auswählbar)',
    single: true,
    items: [
      { key: 'kolonnenfuehrer', label: 'Kolonnenführer', amount: 1 },
      { key: 'kolonnenfuehrer_gross', label: 'Kolonnenführer Teams Großbaustelle', amount: 3 },
      { key: 'kundendienst', label: 'Kundendienst', amount: 2 },
    ],
  },
  {
    title: 'Motoren und Funkprodukte programmieren (Mehrfachauswahl möglich)',
    items: [
      { key: 'motoren_kabel', label: 'Kabelgebundene Motoren', amount: 0.5 },
      { key: 'motoren_funk', label: 'Funkmotoren', amount: 0.5 },
      { key: 'wms', label: 'WMS Produkte mittels WMS Software', amount: 1 },
    ],
  },
  {
    title: 'Qualifikationen / Zertifikate (Mehrfachauswahl möglich)',
    items: [
      { key: 'elektrofachkraft', label: 'Elektrofachkraft für festgelegte Tätigkeiten', amount: 1 },
      { key: 'fuehrerschein_be', label: 'Führerschein BE / Anhänger', amount: 0.5 },
      { key: 'kranschein', label: 'Kranschein', amount: 1 },
    ],
  },
  {
    title: 'Besondere Fähigkeiten',
    items: [
      { key: 'altbau', label: 'Anspruchsvolle Altbaumontage', amount: 2 },
      { key: 'cero', label: 'CERO Montage', amount: 1 },
      { key: 'condoor', label: 'ConDoor Tore', amount: 0.5 },
      { key: 'webertec', label: 'WeberTec Bauwerksabdichtung', amount: 1 },
    ],
  },
  {
    title: 'Arbeitszeit',
    items: [
      { key: 'uebernachtung', label: 'Übernachtung mindestens 10 Wochen pro Jahr', amount: 0.5 },
      { key: 'samstag', label: 'Samstagsarbeit mindestens 12 Samstage pro Jahr', amount: 0.5 },
    ],
  },
  {
    title: 'Begünstigungen',
    items: [{ key: 'privatnutzung_bus', label: 'Privatnutzung Bus für den Weg von der Firma nach Hause', amount: -1.5 }],
  },
]

export const WAGE_ITEMS = WAGE_GROUPS.flatMap((g) => [...g.items, ...(g.alternative ?? [])])

// volle Jahre zwischen zwei Daten
export function fullYears(from: string | null | undefined, to = new Date()) {
  if (!from) return null
  const d = new Date(from + 'T00:00')
  let y = to.getFullYear() - d.getFullYear()
  if (to.getMonth() < d.getMonth() || (to.getMonth() === d.getMonth() && to.getDate() < d.getDate())) y--
  return y
}

// Lohnkonzept: Summe der Haken, je volle 3 Jahre Betriebszugehörigkeit 0,30 € (Fabian, 2026-10-26)
export function wageConcept(selected: Record<string, unknown>, entryDate: string | null | undefined) {
  const base = WAGE_ITEMS.reduce((s, i) => s + (selected[i.key] ? i.amount : 0), 0)
  const years = fullYears(entryDate) ?? 0
  const seniority = Math.floor(Math.max(0, years) / 3) * 0.3
  return { base, seniority, total: base + seniority }
}

// ---------------------------------------------------------------- Formatierung

export const euro = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })

export function show(f: Field, v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (f.type === 'date') {
    const s = String(v).slice(0, 10)
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00').toLocaleDateString('de-DE') : String(v)
  }
  if (f.type === 'datetime') {
    const d = new Date(String(v))
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
  }
  if (f.type === 'money') return Number.isFinite(Number(v)) ? euro(Number(v)) : String(v)
  if (f.type === 'number') return Number.isFinite(Number(v)) ? Number(v).toLocaleString('de-DE') + (f.unit ? ' ' + f.unit : '') : String(v)
  if (f.type === 'yesno') return v ? 'Ja' : 'Nein'
  return String(v)
}

// Eingabewert -> gespeicherter Wert
export function parse(f: Field, raw: string): unknown {
  const t = raw.trim()
  if (f.type === 'number' || f.type === 'money') {
    if (!t) return null
    const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
    return Number.isFinite(n) ? n : t
  }
  if (f.type === 'date' || f.type === 'datetime') return t || null
  return t
}

export function toInput(f: Field, v: unknown): string {
  if (v === null || v === undefined) return ''
  if ((f.type === 'number' || f.type === 'money') && typeof v === 'number') return String(v).replace('.', ',')
  if (f.type === 'date') return String(v).slice(0, 10)
  if (f.type === 'datetime') {
    const d = new Date(String(v))
    if (Number.isNaN(d.getTime())) return ''
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
  }
  return String(v)
}

// Namen für den Vergleich (Ninox-Feldnamen, Personennamen)
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, '')

// Login-Adresse nach Schema vorname.nachname@joleka.de (Umlaute ae/oe/ue, ß -> ss)
export function companyEmail(first: string, last: string) {
  const part = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
  return `${part(first)}.${part(last)}@joleka.de`
}

export interface Employee {
  id: number
  user_id: string | null
  personnel_number: string
  status: string
  first_name: string
  last_name: string
  department: string
  entry_date: string | null
  vacation_days: number | null
  wage_concept: Record<string, boolean>
  updated_at: string
  [key: string]: unknown
}

export interface Entry {
  id: number
  employee_id: number
  kind: string
  data: Record<string, unknown>
}

export const employeeName = (e: { first_name?: unknown; last_name?: unknown }) =>
  [e.first_name, e.last_name].filter(Boolean).join(' ') || 'Ohne Namen'

// Für die Lohnabrechnung nötige Angaben (Fabian, 2026-10-27). Geprüft wird bei allen, die nicht "nicht aktiv" sind.
export const PAYROLL_REQUIRED = [
  'personnel_number', 'tax_class', 'birth_date', 'nationality', 'street', 'house_no', 'zip', 'city',
  'entry_date', 'employment_type', 'weekly_hours', 'wage_type', 'tax_id', 'church_tax', 'social_security_no',
  'health_insurance', 'iban',
]

// Geschäftsführer brauchen keine(n) Vorgesetzte(n) (Fabian, 2026-10-27); gesteuert über die Abteilung "Geschäftsführung"
export const isManagingDirector = (e: Record<string, unknown>) => String(e.department ?? '').trim().toLowerCase() === 'geschäftsführung'

// fehlende Pflichtangaben als Feldnamen; hasWage: gibt es einen Eintrag unter "Lohn und Gehalt"?
// supervisor: App-Benutzer hat eine(n) Vorgesetzte(n) (null = kein App-Benutzer, dann nicht prüfbar)
export function missingPayroll(e: Record<string, unknown>, hasWage: boolean, supervisor: boolean | null = null): string[] {
  if (e.status === 'nicht aktiv') return []
  const missing = PAYROLL_REQUIRED.filter((k) => e[k] === null || e[k] === undefined || String(e[k]).trim() === '').map((k) => F[k].label)
  if (!hasWage) missing.push('Lohn und Gehalt (Stundenlohn / Gehalt)')
  if (supervisor === false && !isManagingDirector(e)) missing.push('Vorgesetzte(r) (Reiter App-Benutzer)')
  return missing
}
