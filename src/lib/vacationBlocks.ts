import { formatDay } from './types'

// Urlaubssperren und Betriebsferien (Tabelle vacation_blocks)
export type BlockKind = 'sperre' | 'betriebsferien'

export interface VacationBlock {
  id: number
  kind: BlockKind
  start_date: string
  end_date: string
  reason: string
  departments: string[]
}

export const BLOCK_LABEL: Record<BlockKind, string> = { sperre: 'Urlaubssperre', betriebsferien: 'Betriebsferien' }

export function blockPeriod(b: Pick<VacationBlock, 'start_date' | 'end_date'>) {
  return b.start_date === b.end_date ? formatDay(b.start_date) : `${formatDay(b.start_date)} – ${formatDay(b.end_date)}`
}

// Kurzer Text für Hinweise, z. B. "Urlaubssperre Mi 01.07. – Fr 31.07. (Inventur)"
export function blockText(b: Pick<VacationBlock, 'kind' | 'start_date' | 'end_date' | 'reason'>) {
  return `${BLOCK_LABEL[b.kind]} ${blockPeriod(b)}${b.reason ? ` (${b.reason})` : ''}`
}
