// Browser-Autofill (Chrome/Edge) in Adressfeldern abschalten, damit es unsere eigenen Vorschläge nicht überdeckt.
// autocomplete="off" ignorieren Chrome/Edge bei Adressen. Ein unbekannter autocomplete-Wert schaltet die
// Adresserkennung ab, ein name mit Zufallsteil verhindert Vorschläge aus früheren Eingaben.
const seed = Math.random().toString(36).slice(2, 8)

export function noAutofill(field: string) {
  return {
    autoComplete: `jlk-${field}-${seed}`,
    name: `jlk-${field}-${seed}`,
    // Passwortmanager (LastPass, 1Password u. a.) ebenfalls fernhalten
    'data-lpignore': 'true',
    'data-1p-ignore': 'true',
    'data-form-type': 'other',
  }
}
