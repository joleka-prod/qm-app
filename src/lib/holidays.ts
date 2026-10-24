import { addDays, isoDate } from './types'

// Gesetzliche Feiertage in Rheinland-Pfalz. Muss zu public.is_holiday_rlp in der Datenbank passen.
function easterSunday(year: number) {
  // Gaußsche Osterformel (Meeus/Jones/Butcher)
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

const cache: Record<number, Record<string, string>> = {}

function holidaysOf(year: number) {
  if (cache[year]) return cache[year]
  const e = easterSunday(year)
  const list: Record<string, string> = {
    [`${year}-01-01`]: 'Neujahr',
    [isoDate(addDays(e, -2))]: 'Karfreitag',
    [isoDate(addDays(e, 1))]: 'Ostermontag',
    [`${year}-05-01`]: 'Tag der Arbeit',
    [isoDate(addDays(e, 39))]: 'Christi Himmelfahrt',
    [isoDate(addDays(e, 50))]: 'Pfingstmontag',
    [isoDate(addDays(e, 60))]: 'Fronleichnam',
    [`${year}-10-03`]: 'Tag der Deutschen Einheit',
    [`${year}-11-01`]: 'Allerheiligen',
    [`${year}-12-25`]: '1. Weihnachtstag',
    [`${year}-12-26`]: '2. Weihnachtstag',
  }
  return (cache[year] = list)
}

// Name des Feiertags am Tag (YYYY-MM-DD) oder ''
export function holidayName(day: string) {
  return holidaysOf(Number(day.slice(0, 4)))[day] ?? ''
}
