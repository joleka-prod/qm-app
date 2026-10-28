import { useEffect, useRef, useState } from 'react'

// Kalender merken sich Woche, Bereich und Scrollposition, solange der Browser-Tab offen ist.
// Wer in ein anderes Menü wechselt und zurückkommt, landet wieder an derselben Stelle.

function read<T>(key: string): T | undefined {
  try {
    const raw = sessionStorage.getItem(key)
    return raw === null ? undefined : (JSON.parse(raw) as T)
  } catch {
    return undefined
  }
}

function write(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* egal */
  }
}

// Wie useState, der Wert bleibt aber für den Tab gespeichert
export function useRemembered<T>(key: string, initial: () => T) {
  const [value, setValue] = useState<T>(() => read<T>(key) ?? initial())
  useEffect(() => write(key, value), [key, value])
  return [value, setValue] as const
}

type ScrollPos = { y: number; x: number }

// Merkt die senkrechte Scrollposition der Seite und die waagerechte der Kalendertabelle (.cal-scroll).
// Wiederhergestellt wird einmal, sobald ready (Daten geladen) zum ersten Mal true ist.
export function useScrollMemory(key: string, ready: boolean) {
  const restored = useRef(false)

  useEffect(() => {
    let frame = 0
    const save = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // erst speichern, wenn wiederhergestellt ist, sonst überschreibt der Seitenwechsel die alte Position
        if (!restored.current) return
        const table = document.querySelector('.cal-scroll')
        write(key, { y: window.scrollY, x: table?.scrollLeft ?? 0 } satisfies ScrollPos)
      })
    }
    // capture: fängt auch das Scrollen in der Tabelle ab
    window.addEventListener('scroll', save, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', save, true)
    }
  }, [key])

  useEffect(() => {
    if (!ready || restored.current) return
    const pos = read<ScrollPos>(key)
    requestAnimationFrame(() => {
      if (pos) {
        window.scrollTo(0, pos.y)
        const table = document.querySelector('.cal-scroll')
        if (table) table.scrollLeft = pos.x
      } else {
        window.scrollTo(0, 0)
      }
      restored.current = true
    })
  }, [key, ready])
}

// Springt zur heutigen Spalte bzw. zum heutigen Tag (nach dem Neuzeichnen)
export function scrollToToday() {
  setTimeout(() => {
    const el = document.querySelector('.cal-today, .agenda-today')
    if (el) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
    else window.scrollTo({ top: 0, behavior: 'smooth' })
  }, 100)
}
