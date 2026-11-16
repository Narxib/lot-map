// Reads a fetched message list and exercises the map's pure parts over it: the board, the rows and the drawing.
// Prints stations, counts and labels only, never message content.
import { readFileSync } from 'node:fs'
import { boardFrom } from '../src/board'
import { drawMap } from '../src/draw'
import { foldRows, nowParts } from '../src/feed'
import { setupFrom } from '../src/setup'

const file = process.argv[2]
if (file === undefined) throw new Error('usage: board-check <messages.json>')
const raw = JSON.parse(readFileSync(file, 'utf8')) as { data?: unknown[] } | unknown[]
const messages = (Array.isArray(raw) ? raw : (raw.data ?? [])) as never[]

const setup = setupFrom({})
const check = (input: never[], label: string): void => {
  const board = boardFrom({ messages: input, now: Date.now(), setup })
  const rows = foldRows(board.entries, 18)
  const parts = nowParts(board, setup.t)
  const svg = drawMap(board, Date.now(), setup, true)
  console.log(`${label}: entries ${board.entries.length}, rows ${rows.length}, svg ${svg.length}, model ${board.model ?? '—'}`)
  console.log(`  now: ${parts.what}${parts.meter === '' ? '' : ` · ${parts.meter}`}`)
  if (rows[0] !== undefined) console.log(`  first row: ${rows[0].entry.label} (${rows[0].entry.station})`)
}

check(messages, 'live')
check([], 'empty')

const board = boardFrom({ messages, now: Date.now(), setup })
console.log('\ncounts', board.counts, 'step', board.step, 'faults', board.faults ?? {})
const byStation: Record<string, string[]> = {}
for (const e of board.entries) {
  ;(byStation[e.station] ??= []).push(`${e.label} [${e.status}]${e.tokens !== undefined ? ` ~${e.tokens}` : ''}`)
}
for (const [station, labels] of Object.entries(byStation)) {
  console.log(`${station} (${labels.length}): ${labels.slice(0, 10).join(' | ')}${labels.length > 10 ? ` … +${labels.length - 10}` : ''}`)
}
