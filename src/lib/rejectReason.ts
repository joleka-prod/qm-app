// Grund für eine Ablehnung abfragen: Pflicht, fragt erneut bis etwas eingetragen ist. null = abgebrochen.
export function rejectReason(): string | null {
  for (let retry = false; ; retry = true) {
    const answer = prompt(retry ? 'Bitte einen Grund angeben (mindestens 3 Zeichen):' : 'Grund für die Ablehnung (Pflicht):')
    if (answer === null) return null
    if (answer.trim().length >= 3) return answer.trim()
  }
}
