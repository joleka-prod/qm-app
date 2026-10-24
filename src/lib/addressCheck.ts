import { supabase } from './supabase'

export interface AddressToCheck {
  label: string // z. B. "Kundenadresse"
  street: string
  house_no: string
  zip: string
  city: string
  country: string
}

const key = (a: AddressToCheck) => [a.street, a.house_no, a.zip, a.city, a.country].map((v) => v.trim().toLowerCase()).join('|')

// Prüft die Adressen über die Adresssuche (Edge Function calc-distance). Wird eine nicht gefunden,
// fragt die App, ob sie trotzdem so übernommen werden soll. true = speichern, false = korrigieren.
// Ist die Suche nicht erreichbar, fragt die App ebenfalls nach. `before` = unveränderte Adressen werden übersprungen.
export async function confirmAddresses(list: AddressToCheck[], before: AddressToCheck[] = []) {
  const known = new Set(before.map(key))
  for (const a of list) {
    if (![a.street, a.zip, a.city].some((v) => v.trim()) || known.has(key(a))) continue
    const { data, error } = await supabase.functions.invoke('calc-distance', {
      body: { action: 'check', street: a.street, house_no: a.house_no, zip: a.zip, city: a.city, country: a.country },
    })
    const line = [`${a.street} ${a.house_no}`.trim(), `${a.zip} ${a.city}`.trim(), a.country].filter(Boolean).join(', ')
    let ok = true
    if (error || data?.found === null || data?.found === undefined) {
      ok = confirm(
        `Die ${a.label} „${line}“ konnte gerade nicht geprüft werden (Adressprüfung nicht erreichbar).\n\n` +
          'Trotzdem so speichern?\n\nOK = speichern · Abbrechen = zurück',
      )
    } else if (data.found === false) {
      const reason = data.reason ? `\n${data.reason}` : ''
      const hint = data.label ? `\nGefunden wurde nur: ${data.label}` : ''
      ok = confirm(
        `Die ${a.label} „${line}“ wurde bei der Adressprüfung (Navigation) nicht gefunden.${reason}${hint}\n\n` +
          'Ist die Adresse trotzdem korrekt und soll sie so übernommen werden?\n\nOK = so übernehmen · Abbrechen = Adresse korrigieren',
      )
    }
    if (!ok) return false
  }
  return true
}
