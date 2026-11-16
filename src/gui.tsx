// The work map beside the chat: one side panel, drawn from the session's own messages. Nothing here calls the server
// beyond the store the app already keeps.
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'
import { Command, MenuItem, Panel, Plugin, Style, usePlugin } from '@opencode/plugin/gui'
import type { Context, PanelProps, PanelTab } from '@opencode/plugin/gui'
import { boardFrom } from './board'
import { formatMs, formatTokens } from './classify'
import { drawMap } from './draw'
import { foldRows, nowParts } from './feed'
import { DARK, LIGHT } from './palette'
import { setupFrom } from './setup'
import type { Setup } from './setup'
import type { Entry } from './types'

const TAB_ID = 'map'

const CSS = `
.lm-root{display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;padding:10px 10px 0}
.lm-card{border-radius:14px;overflow:hidden;flex:none}
.lm-card svg{display:block;width:100%;height:auto}
.lm-now{display:flex;align-items:baseline;gap:8px;padding:9px 4px 7px;font-size:11.5px;line-height:1.3}
.lm-now .what{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lm-now .meter{flex:none;opacity:.75;font-variant-numeric:tabular-nums}
.lm-feed{flex:1;min-height:0;overflow-y:auto;padding:0 0 10px;scrollbar-width:thin}
.lm-row{display:grid;grid-template-columns:7px auto 1fr auto;align-items:center;gap:8px;padding:4px 6px;border-radius:7px;font-size:11.5px;line-height:1.35}
.lm-row .dot{width:6px;height:6px;border-radius:50%}
.lm-row .where{opacity:.6;max-width:74px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lm-row .what{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lm-row .took{opacity:.55;font-variant-numeric:tabular-nums;font-size:10.5px;white-space:nowrap}
.lm-row[data-run="true"] .dot{animation:lm-beat 1.4s ease-in-out infinite}
.lm-edge{padding:10px 6px;font-size:11.5px;opacity:.6}
@keyframes lm-beat{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.75)}}
`

/** The words the map speaks, following the interface language and the colour scheme. */
function words(ctx: Context): { t: () => Setup['t']; mode: () => 'dark' | 'light'; setup: () => Setup } {
  const mode = (): 'dark' | 'light' => (ctx.appearance.mode() === 'light' ? 'light' : 'dark')
  const language = (): string => {
    const chosen = ctx.options.language
    if (typeof chosen === 'string' && chosen !== '') return chosen
    return ctx.locale.locale().split('-')[0] ?? 'en'
  }
  const setup = createMemo<Setup>(() => setupFrom({ ...ctx.options, language: language() }, mode()))
  return { t: () => setup().t, mode, setup }
}

function MapView(props: PanelProps): JSX.Element {
  const ctx = usePlugin()
  const settings = words(ctx)
  const strings = settings.t
  const mode = settings.mode
  const setup = settings.setup
  const colors = createMemo(() => ({ ...(mode() === 'light' ? LIGHT : DARK), ...setup().colors }))
  const font = (): string => ctx.appearance.font('mono') || 'ui-monospace, SFMono-Regular, Menlo, monospace'

  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(timer))

  const board = createMemo(() => {
    const session = props.session
    const store = session.server.data
    const id = session.id
    const windows = new Map<string, number>()
    for (const model of store.location.model.list(session.location) ?? []) {
      windows.set(model.modelID, model.limit.context)
    }
    const listed = store.session.list()
    const children = store.session
      .family(id)
      .filter(child => child !== id)
      .map(child => {
        const info = listed.find(one => one.id === child)
        return {
          id: child,
          agent: info?.agent,
          running: store.session.status(child) === 'running',
          messages: store.session.message.list(child),
        }
      })
    return boardFrom({
      messages: store.session.message.list(id),
      children,
      pending: store.session.permission.list(id),
      contextLimit: model => (model === undefined ? 0 : (windows.get(model) ?? 0)),
      now: now(),
      setup: setup(),
    })
  })

  const rows = createMemo(() => foldRows(board().entries, 18))
  const parts = createMemo(() => nowParts(board(), strings()))

  // The store loads a page of the transcript and fetches older pages only when the timeline asks. With
  // `history: 'all'`, the map asks once for the rest, so that its counts and step numbers cover the whole session.
  const filled = new Set<string>()
  createEffect(() => {
    if (setup().history !== 'all') return
    const session = props.session
    if (filled.has(session.key)) return
    const store = session.server.data
    if (!store.session.message.more(session.id)) return
    filled.add(session.key)
    void store.session.message.loadMore(session.id, { all: true }).catch(() => filled.delete(session.key))
  })

  let card: HTMLDivElement | undefined
  createEffect(() => {
    const html = drawMap(board(), now(), setup(), true)
    if (card !== undefined) card.innerHTML = html
  })

  const toneOf = (entry: Entry, isRun: boolean): string => {
    const c = colors()
    if (entry.status === 'err' || entry.status === 'block') return c.red
    if (entry.station === 'memory') return c.mem
    return isRun ? c.hot : c.accent
  }

  return (
    <div
      class="lm-root"
      style={{
        'font-family': font(),
        color: colors().bone,
        background: colors().ground,
        '--lm-hover': mode() === 'light' ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.06)',
      }}
    >
      <div class="lm-card" ref={el => (card = el)} />
      <div class="lm-now">
        <span class="what" style={{ color: colors().ash }}>
          {parts().what}
        </span>
        <Show when={parts().meter !== ''}>
          <span class="meter" style={{ color: colors().dim }}>
            {parts().meter}
          </span>
        </Show>
      </div>
      <div class="lm-feed">
        <Show when={rows().length > 0} fallback={<div class="lm-edge">{strings().nothingYet}</div>}>
          <For each={rows()}>
            {row => {
              const entry = row.entry
              const isRun = entry.status === 'run'
              const where = strings().stations[entry.station]
              const took = isRun ? strings().running : row.tookMs > 0 ? formatMs(row.tookMs, strings()) : ''
              const tokens =
                setup().contextCost && row.tokens !== undefined
                  ? `${row.isShared === true ? '~' : ''}${formatTokens(row.tokens)}`
                  : ''
              return (
                <div
                  class="lm-row"
                  data-run={isRun ? 'true' : 'false'}
                  style={{ color: isRun ? colors().bone : colors().ash }}
                  title={`${where}: ${entry.label}`}
                  onMouseEnter={event => (event.currentTarget.style.background = 'var(--lm-hover)')}
                  onMouseLeave={event => (event.currentTarget.style.background = 'transparent')}
                >
                  <span class="dot" style={{ background: toneOf(entry, isRun) }} />
                  <span class="where">{where}</span>
                  <span class="what">
                    {entry.label}
                    <Show when={row.times > 1}>
                      <span style={{ opacity: 0.5 }}>{` ×${row.times}`}</span>
                    </Show>
                  </span>
                  <span class="took">{tokens === '' ? took : `${took} · ${tokens}`}</span>
                </div>
              )
            }}
          </For>
        </Show>
      </div>
    </div>
  )
}

export default Plugin.define({
  setup(ctx) {
    const settings = words(ctx)
    const strings = settings.t

    /** Sessions whose map was already offered once: closing it is the person's choice, and keeps it closed. */
    const seen = new Set<string>()
    const dismissed = new Set<string>()

    const tab = (): PanelTab => ({
      id: TAB_ID,
      get title() {
        return strings().title
      },
      closable: 'hover',
    })

    ctx.add(Style, CSS)

    ctx.add(Panel, {
      id: TAB_ID,
      region: 'side',
      width: 340,
      list: input => (dismissed.has(input.session.key) ? [] : [tab()]),
      render: props => <MapView {...props} />,
      close: input => {
        dismissed.add(input.session.key)
      },
    })

    const open = (session: Parameters<typeof ctx.layout.open>[1], background: boolean): void => {
      dismissed.delete(session.key)
      ctx.layout.open(`${ctx.id}:${TAB_ID}`, session, background ? { tab: 'select', background: true } : { tab: 'open' })
    }

    ctx.add(Command, () => ({
      id: 'open',
      get title() {
        return strings().command
      },
      section: 'session' as const,
      slash: { name: 'lotmap' },
      run: () => {
        const session = ctx.sessions.current()
        if (session !== undefined) open(session, false)
      },
    }))

    ctx.add(MenuItem, () => ({
      id: 'open',
      menu: 'session.panel' as const,
      get title() {
        return strings().title
      },
      icon: 'branch-out' as const,
      run: () => {
        const session = ctx.sessions.current()
        if (session !== undefined) open(session, false)
      },
    }))

    // The map opens by itself, once per session, unless the person has closed it there.
    createEffect(() => {
      const session = ctx.sessions.current()
      if (session === undefined || seen.has(session.key)) return
      seen.add(session.key)
      if (ctx.options.autoOpen === false || dismissed.has(session.key)) return
      const key = `${ctx.id}:${TAB_ID}`
      if (ctx.layout.state(key, session) !== 'closed') return
      ctx.layout.open(key, session, { tab: 'select', background: true })
    })
  },
})
