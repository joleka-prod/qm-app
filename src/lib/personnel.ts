// Personalakte: Felder, Abschnitte und Hilfen für Anzeige und Ninox-Import.

export type FieldType = 'text' | 'date' | 'number' | 'secret' | 'textarea'

export interface PersonnelField {
  key: string
  label: string
  type: FieldType
  // Vermutung für die Spalte im Ninox-Import
  guess: RegExp
}

export const PERSONNEL_SECTIONS: { title: string; fields: PersonnelField[] }[] = [
  {
    title: 'Person',
    fields: [
      { key: 'personnel_number', label: 'Personalnummer', type: 'text', guess: /personal.?n(umme)?r|pers\.?.?nr|mitarbeiter.?nr/i },
      { key: 'salutation', label: 'Anrede', type: 'text', guess: /^anrede$/i },
      { key: 'first_name', label: 'Vorname', type: 'text', guess: /vorname/i },
      { key: 'last_name', label: 'Nachname', type: 'text', guess: /nachname|familienname/i },
      { key: 'birth_name', label: 'Geburtsname', type: 'text', guess: /geburtsname/i },
      { key: 'birth_date', label: 'Geburtsdatum', type: 'date', guess: /geburtsdatum|geb\.?.?datum|geboren am/i },
      { key: 'birth_place', label: 'Geburtsort', type: 'text', guess: /geburtsort/i },
      { key: 'nationality', label: 'Staatsangehörigkeit', type: 'text', guess: /staatsangeh|nationalit/i },
    ],
  },
  {
    title: 'Anschrift und Kontakt',
    fields: [
      { key: 'street', label: 'Straße und Hausnummer', type: 'text', guess: /stra(ß|ss)e|anschrift|adresse/i },
      { key: 'zip', label: 'PLZ', type: 'text', guess: /^plz$|postleitzahl/i },
      { key: 'city', label: 'Ort', type: 'text', guess: /^(ort|wohnort|stadt)$/i },
      { key: 'phone', label: 'Telefon', type: 'text', guess: /telefon|handy|mobil/i },
      { key: 'private_email', label: 'Private E-Mail', type: 'text', guess: /privat.*mail/i },
      { key: 'emergency_contact', label: 'Notfallkontakt', type: 'textarea', guess: /notfall/i },
    ],
  },
  {
    title: 'Bankverbindung',
    fields: [
      { key: 'iban', label: 'IBAN', type: 'secret', guess: /iban/i },
      { key: 'bic', label: 'BIC', type: 'text', guess: /^bic$|swift/i },
      { key: 'bank_name', label: 'Bank', type: 'text', guess: /^bank$|kreditinstitut|bankname/i },
    ],
  },
  {
    title: 'Steuer und Sozialversicherung',
    fields: [
      { key: 'tax_id', label: 'Steuer-ID', type: 'secret', guess: /steuer.?id|identifikationsn|steuernummer/i },
      { key: 'tax_class', label: 'Steuerklasse', type: 'text', guess: /steuerklasse/i },
      { key: 'child_allowance', label: 'Kinderfreibeträge', type: 'number', guess: /kinderfreibetr/i },
      { key: 'confession', label: 'Konfession (Kirchensteuer)', type: 'text', guess: /konfession|religion|kirche/i },
      { key: 'social_security_number', label: 'Sozialversicherungsnummer', type: 'secret', guess: /sozialvers|sv.?n(umme)?r|rentenvers/i },
      { key: 'health_insurance', label: 'Krankenkasse', type: 'text', guess: /krankenkasse|krankenversicherung/i },
      { key: 'disability', label: 'Schwerbehinderung', type: 'text', guess: /schwerbehind|behinderung/i },
    ],
  },
  {
    title: 'Beschäftigung und Lohn',
    fields: [
      { key: 'entry_date', label: 'Eintritt', type: 'date', guess: /eintritt/i },
      { key: 'exit_date', label: 'Austritt', type: 'date', guess: /austritt/i },
      { key: 'job_title', label: 'Tätigkeit / Funktion', type: 'text', guess: /t[äa]tigkeit|funktion|position|beruf/i },
      { key: 'employment_type', label: 'Beschäftigungsart', type: 'text', guess: /besch[äa]ftigungsart|vertragsart|anstellung/i },
      { key: 'hourly_wage', label: 'Stundenlohn (€)', type: 'number', guess: /stundenlohn/i },
      { key: 'monthly_salary', label: 'Monatsgehalt (€)', type: 'number', guess: /gehalt|monatslohn/i },
      { key: 'notes', label: 'Notizen', type: 'textarea', guess: /^notiz|bemerkung/i },
    ],
  },
]

export const PERSONNEL_FIELDS = PERSONNEL_SECTIONS.flatMap((s) => s.fields)
export const PERSONNEL_LABEL: Record<string, string> = Object.fromEntries(PERSONNEL_FIELDS.map((f) => [f.key, f.label]))

export type PersonnelFile = Record<string, unknown> & {
  user_id: string
  personnel_number: string
  extra: Record<string, unknown>
  // Einträge der verknüpften Ninox-Tabellen je Tabelle
  related?: Record<string, Record<string, string>[]>
  updated_at?: string
  updated_by?: string | null
}

// Nur die letzten 4 Zeichen zeigen, z. B. IBAN
export function masked(v: unknown) {
  const s = String(v ?? '')
  return s.length <= 4 ? s : '•••• ' + s.slice(-4)
}

// Wert für die Datenbank aus einem Eingabefeld
export function toDb(f: PersonnelField, v: string): unknown {
  const t = v.trim()
  if (f.type === 'date') return t || null
  if (f.type === 'number') {
    if (!t) return null
    // deutsche Schreibweise "1.234,50" oder "38,5", sonst "38.5"
    const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
    return Number.isFinite(n) ? n : null
  }
  if (f.key === 'iban') return t.replace(/\s+/g, '').toUpperCase()
  return t
}

export function toInput(f: PersonnelField, v: unknown) {
  if (v === null || v === undefined) return ''
  if (f.type === 'number') return String(v).replace('.', ',')
  return String(v)
}

export function display(f: PersonnelField, v: unknown) {
  if (v === null || v === undefined || v === '') return '–'
  if (f.type === 'date') return new Date(String(v) + 'T00:00').toLocaleDateString('de-DE')
  if (f.type === 'number') return Number(v).toLocaleString('de-DE', { maximumFractionDigits: 2 })
  if (f.key === 'iban') return String(v).replace(/(.{4})/g, '$1 ').trim()
  return String(v)
}
