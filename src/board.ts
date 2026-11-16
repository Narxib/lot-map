// The board: a session's work read from its messages, station by station. Nothing here draws, and no label carries
// the text of a message, a file or a memory: names and numbers only.
import { classify, clean, shortModel } from './classify'
import type { Setup } from './setup'
import type { Board, Entry, StationId, Status } from './types'

/** A part of an assistant message, as the host's store holds it. */
export type ToolPart = {
  type: string
  id?: string
  name?: string
  state?: { status?: string; input?: unknown }
  time?: { created?: number; ran?: number; completed?: number }
}

export type Tokens = { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }

/** One message of a session, read for the fields the map uses. */
export type Message = {
  id?: string
  type: string
  time?: { created?: number; completed?: number }
  content?: readonly ToolPart[]
  model?: { id?: string }
  agent?: string
  tokens?: Tokens
  finish?: string
  outcome?: string
  status?: string
  /** A `shell` message: a command the person ran in a terminal tab. */
  command?: string
  /** A `skill` message: the skill that came into play. */
  name?: string
  skill?: string
}

/** A subagent's loop: its session, and what it did. */
export type Child = {
  id: string
  agent?: string
  running?: boolean
  messages: readonly Message[]
}

/** A permission request still waiting for the person. */
export type Pending = {
  id: string
  action: string
}

export type BoardInput = {
  messages: readonly Message[]
  children?: readonly Child[]
  pending?: readonly Pending[]
  /** The context window of a model, in tokens; 0 when it is not known. */
  contextLimit?: (model: string | undefined) => number
  /** The moment the board describes, for what has no clock of its own. */
  now: number
  setup: Setup
}

const at = (m: Message): number => m.time?.created ?? 0

/** What a message's tokens say about how full the context is, or was. */
const usedOf = (tokens: Tokens): number => (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The command a shell message ran, as its own program: a name, never the arguments. */
const programOf = (command: string): string => {
  const word = (command.trim().split(/\s+/)[0] ?? '').replace(/^["']|["']$/g, '')
  const name = word.replace(/\\/g, '/').split('/').pop() ?? word
  return clean(name.replace(/\.(?:exe|cmd|bat)$/i, ''), 32) || 'shell'
}

/** The status a tool part ended in, or is still in. */
const statusOf = (state: ToolPart['state']): Status =>
  state?.status === 'error' ? 'err' : state?.status === 'completed' ? 'ok' : state?.status === 'running' || state?.status === 'streaming' ? 'run' : 'run'

export function boardFrom(input: BoardInput): Board {
  const { setup } = input
  // The store may hand messages over newest first; the map reads a turn in the order it happened.
  const messages = [...input.messages].sort((a, b) => at(a) - at(b))
  const t = setup.t
  const entries: Entry[] = []
  /** The calls of the step being read, whose share of the context growth is counted with it. */
  let stepEntries: Entry[] = []
  let step = 0
  let model: string | undefined
  let switchedAt: number | undefined
  let context: number | undefined
  let used = 0
  const limitOf = input.contextLimit ?? (() => 0)
  const spent: Partial<Record<StationId, number>> | undefined = setup.contextCost ? {} : undefined

  const add = (entry: Entry): Entry => {
    entries.push(entry)
    stepEntries.push(entry)
    return entry
  }

  /** How much the context grew with this step's answer, shared evenly with the calls that made it. */
  const grown = (tokens: Tokens): void => {
    const now = usedOf(tokens)
    const growth = Math.max(0, now - used)
    used = now
    if (spent === undefined || growth === 0 || stepEntries.length === 0) return
    const each = Math.round(growth / stepEntries.length)
    if (each === 0) return
    for (const entry of stepEntries) {
      entry.tokens = each
      entry.shared = stepEntries.length > 1
      spent[entry.station] = (spent[entry.station] ?? 0) + each
    }
  }

  for (const message of messages) {
    switch (message.type) {
      case 'user':
        step = 0
        entries.push({
          id: `${message.id ?? `u${at(message)}`}:you`,
          station: 'you',
          label: t.newMessage,
          from: 'inbound',
          startedAt: at(message),
          endedAt: at(message),
          status: 'ok',
        })
        break

      case 'assistant': {
        step++
        stepEntries = []
        const said = message.model?.id
        if (said !== undefined && said !== '') model = said
        const done = message.time?.completed
        const failed = message.finish === 'error'
        entries.push({
          id: `${message.id ?? `a${at(message)}`}:step`,
          station: 'model',
          label: t.step(step),
          from: 'core',
          startedAt: at(message),
          endedAt: done,
          status: failed ? 'err' : done === undefined ? 'run' : 'ok',
        })
        for (const part of message.content ?? []) {
          if (part.type !== 'tool') continue
          const state = part.state
          const name = part.name ?? 'tool'
          const seen = classify(name, isRecord(state?.input) ? state.input : {}, setup)
          const status = statusOf(state)
          const startedAt = part.time?.created ?? at(message)
          const endedAt = status === 'run' ? undefined : (part.time?.completed ?? part.time?.ran ?? startedAt)
          add({
            id: `${message.id ?? `a${at(message)}`}:${part.id ?? name}`,
            station: seen.station,
            label: clean(seen.label),
            from: 'core',
            startedAt,
            endedAt,
            status,
          })
        }
        if (message.tokens !== undefined) {
          grown(message.tokens)
          const limit = limitOf(said ?? model)
          context = limit > 0 ? Math.min(100, (used / limit) * 100) : undefined
        }
        break
      }

      case 'model-switched': {
        if (message.model?.id === undefined || message.model.id === '') break
        model = message.model.id
        switchedAt = at(message)
        entries.push({
          id: `${message.id ?? `m${at(message)}`}:switch`,
          station: 'model',
          label: shortModel(message.model.id),
          from: 'core',
          startedAt: at(message),
          endedAt: at(message),
          status: 'ok',
          mark: 'switch',
        })
        break
      }

      case 'compaction': {
        const status: Status = message.status === 'completed' ? 'ok' : message.status === 'failed' ? 'err' : 'run'
        entries.push({
          id: `${message.id ?? `c${at(message)}`}:compaction`,
          station: 'memory',
          label: t.compacting,
          from: 'core',
          startedAt: at(message),
          endedAt: status === 'run' ? undefined : at(message) + 1,
          status,
        })
        break
      }

      case 'idle': {
        const interrupted = message.outcome === 'interrupted'
        entries.push({
          id: `${message.id ?? `i${at(message)}`}:idle`,
          station: 'you',
          label: interrupted ? t.turnAborted : t.answerReady,
          from: 'core',
          startedAt: at(message),
          endedAt: at(message) + 1,
          status: message.outcome === 'failed' ? 'err' : interrupted ? 'block' : 'ok',
          mark: 'done',
        })
        break
      }

      case 'shell': {
        const command = message.command ?? ''
        if (command.trim() === '') break
        const running = message.status === 'running'
        entries.push({
          id: `${message.id ?? `s${at(message)}`}:shell`,
          station: 'shell',
          label: programOf(command),
          from: 'inbound',
          startedAt: at(message),
          endedAt: running ? undefined : (message.time?.completed ?? at(message) + 1),
          status: running ? 'run' : message.status === 'exited' ? 'ok' : 'err',
        })
        break
      }

      case 'skill': {
        const name = message.name ?? message.skill ?? ''
        if (name === '') break
        entries.push({
          id: `${message.id ?? `k${at(message)}`}:skill`,
          station: 'skills',
          label: clean(name, 40),
          from: 'inbound',
          startedAt: at(message),
          endedAt: at(message) + 1,
          status: 'ok',
        })
        break
      }

      default:
        break
    }
  }

  // Each subagent's calls start at its own station, so a pulse from there says the work was handed over.
  for (const child of input.children ?? []) {
    for (const message of child.messages) {
      if (message.type !== 'assistant') continue
      for (const part of message.content ?? []) {
        if (part.type !== 'tool') continue
        const state = part.state
        const name = part.name ?? 'tool'
        const seen = classify(name, isRecord(state?.input) ? state.input : {}, setup)
        const status = statusOf(state)
        const startedAt = part.time?.created ?? at(message)
        entries.push({
          id: `${child.id}:${message.id ?? at(message)}:${part.id ?? name}`,
          station: seen.station,
          label: clean(seen.label),
          from: 'agents',
          agentId: child.agent ?? child.id,
          startedAt,
          endedAt: status === 'run' ? undefined : (part.time?.completed ?? part.time?.ran ?? startedAt),
          status,
        })
      }
    }
  }

  // A request the person has not answered yet holds the permits station at work.
  for (const request of input.pending ?? []) {
    entries.push({
      id: `permission:${request.id}`,
      station: 'hooks',
      label: clean(t.askedPermission(request.action)),
      from: 'core',
      startedAt: input.now,
      status: 'run',
    })
  }

  entries.sort((a, b) => a.startedAt - b.startedAt)

  const counts: Partial<Record<StationId, number>> = {}
  for (const entry of entries) {
    if (entry.mark !== undefined) continue
    counts[entry.station] = (counts[entry.station] ?? 0) + 1
  }

  // What went wrong since the person's last message: a badge clears with the next one.
  let faultsAt = -1
  entries.forEach((entry, i) => {
    if (entry.from === 'inbound' && entry.station === 'you') faultsAt = i
  })
  const faults: Partial<Record<StationId, number>> = {}
  for (let i = faultsAt + 1; i < entries.length; i++) {
    const entry = entries[i]
    if (entry === undefined || (entry.status !== 'err' && entry.status !== 'block')) continue
    faults[entry.station] = (faults[entry.station] ?? 0) + 1
  }

  const agents = (input.children ?? []).filter(child => child.running === true).map(child => child.agent ?? child.id)

  return {
    entries,
    counts,
    ...(model === undefined ? {} : { model }),
    ...(step === 0 ? {} : { step }),
    ...(faultsAt < 0 || Object.keys(faults).length === 0 ? {} : { faults }),
    ...(agents.length === 0 ? {} : { agents }),
    ...(context === undefined ? {} : { context }),
    ...(spent === undefined ? {} : { spent }),
    ...(switchedAt === undefined ? {} : { switchedAt }),
  }
}
