# lot-map for OpenCode

A live work map beside the chat: a ring of stations, one for each kind of work a session does, and a feed of
what just happened. It is a port of [alexeyw/lot-map](https://github.com/alexeyw/lot-map), which was written for
Claude Code hooks, to an OpenCode Desktop GUI plugin.

The map is built from the session's own messages, as the app already keeps them. Nothing is sent anywhere, and a
label is always a name or a number — a tool, a host, the last two parts of a path, a step count, a duration, a
token count. No message text, file content or memory ever reaches the map.

## Installing

Requires OpenCode Desktop 2.3 or newer. The desktop app loads a plugin's GUI from the **global**
`opencode.json(c)`; an entry in a project config does not reach its windows.

```sh
opencode plugin add github:Narxib/lot-map
```

Or add it to the `plugins` array in `~/.config/opencode/opencode.json` yourself:

```json
{
  "plugins": ["github:Narxib/lot-map"]
}
```

The map opens by itself the first time a session is seen. It can also be opened from the session's panel menu, or
with the `/lotmap` command. **Settings > Extensions > Plugins** lists it with a switch for its desktop UI.

To set options, use the object form:

```json
{
  "plugins": [
    {
      "package": "github:Narxib/lot-map",
      "options": { "language": "es", "textSize": "body", "contextCost": true }
    }
  ]
}
```

## Options

Every option is optional; what is missing or malformed counts as not set.

| Option | Values | Default | Meaning |
| --- | --- | --- | --- |
| `language` | `en`, `ru`, `es`, `fr`, `de`, `it`, `pt` | the app's language | The words on the map and in the feed. |
| `coreName` | a short name | `OPENCODE` | The name at the centre of the ring. |
| `theme` | `dark`, `light` | the app's colour scheme | The palette. |
| `background` | `solid`, `transparent` | `solid` | Whether the map paints its own ground. |
| `colors` | `accent=#ff9900, background=#101418` | the palette's own | Colours by palette name; `#rgb` and `#rrggbb` only. |
| `layout` | `you-top`, `you-bottom` | `you-top` | Who sits at the top of the ring. |
| `motion` | `full`, `reduced` | `full` | With `reduced`, nothing flies, spreads or spins. |
| `textSize` | `caption`, `footnote`, `body` | `footnote` | The size of the words under the map. |
| `autoOpen` | `true`, `false` | `true` | Open the panel by itself when a session is first seen. |
| `history` | `recent`, `all` | `recent` | `recent` reads the messages the app has loaded; `all` asks for the whole transcript once, so counts and step numbers cover the session. |
| `contextCost` | `true`, `false` | `false` | Show about how much each call added to the context, and each station's sum. |
| `hookReasons` | `true`, `false` | `false` | Name the first line of a refusal's reason. |
| `subagentNames` | `true`, `false` | `false` | Say which subagent a step belongs to. |
| `memoryServers` | server names, comma-separated | none | MCP servers whose calls count as memory. |
| `memoryCommands` | command names | none | Shell commands that work on the person's memory. |
| `memorySubcommands` | words | none | The words after a memory command that may be shown. |
| `memoryPaths` | path parts | none | Paths whose files count as memory. |
| `memoryLabels` | `tool=label` pairs | none | Names for a memory server's tools. |

A station is one of: you, model, memory, files, shell, web, browser, agents, skills, permits.

## Developing

A local directory works the same way as a package. Point `plugins` at this folder instead:

```json
{
  "plugins": [{ "package": "C:/path/to/lot-map", "options": {} }]
}
```

```sh
npm install
npm run typecheck
npm run build
```

The build writes `dist/gui-experimental.cjs`, which is the entry the app loads (`./gui-experimental` in
`package.json`). Rebuilding is enough to pick up a change: the app reloads the plugin's GUI without restarting the
service. `dist/` is committed so that a GitHub install needs no build step on the user's machine.

`tools/board-check.ts` runs the pure parts — board, feed and drawing — over a fetched message list:

```sh
npx esbuild tools/board-check.ts --bundle --platform=node --format=cjs --outfile=board-check.cjs
node board-check.cjs path/to/messages.json
```

## Where things live

| File | What it does |
| --- | --- |
| `src/gui.tsx` | The panel, the command, the menu item and the auto-open rule. |
| `src/board.ts` | Reads a session's messages into a board: entries, counts, model, step, context, faults. |
| `src/classify.ts` | Which station a tool belongs to and what it is called; model names and number formats. |
| `src/draw.ts` | The ring and the feed's drawing, as SVG. |
| `src/feed.ts` | Folds entries into rows, and says what is happening now. |
| `src/setup.ts` | Stations and the plugin's options made ready to use. |
| `src/text.ts` | The words, in seven languages. |
| `src/palette.ts` | Dark and light palettes. |
| `src/types.ts` | The shapes shared by the modules above. |
| `reference/` | The original Claude Code hook modules, kept for comparison. |

## Limits

- The map follows the open session. There is no cross-session board.
- By default the map reads the page of messages the app has loaded (about the last 50); older work is not counted.
  Set `history` to `all` to load the whole transcript, at the cost of reading every message of a long session.
- The panel is per session, one at a time, and belongs to the GUI; the TUI has no map.
- The GUI plugin API is experimental and may change between OpenCode releases. The bundle targets OpenCode 2.3.

## Credits

- Original [lot-map](https://github.com/alexeyw/lot-map) for Claude Code, by Aleksei Volodin.
- The OpenCode port keeps the original drawing, stations, feed and copy, and reads them from OpenCode's message
  store instead of Claude Code hooks.

MIT licensed; the original copyright notice is in [LICENSE](LICENSE).
