# Longtable

**Plan it together.** Longtable is a live, shared planning board. Everyone on a
board writes sticky notes at once and sees each other's cursors, names and
typing as it happens. When the mess is done, one click on **Tidy up** files
every note into the day it names, Monday to Sunday, in time order, and the week
can go out as text, a spreadsheet or a calendar file.

The first board it ships with is the example from the film it grew out of:
**Pell & Rye · Opening week**, a fictional bakery planning its first week with
five fictional people.

> Status: preview. The repository is private until the first public release.

## What you can do

- **Plan live with anyone who has the link.** No accounts: a board is a link.
  Cursors carry a name flag and leave a short streak when they move fast;
  people see what you select and the words you type, as you type them.
- **Notes, headings, checklists, pen.** Double-click the canvas for a note
  (`N`), `T` for a heading, `C` for a checklist, `P` to draw. Drag to move,
  drag the empty canvas to select several, `Alt`-drag to copy, paste a list of
  lines to get one note per line.
- **Vote and react.** Voting dots in your colour sit on a note; reactions float
  up from your cursor for everyone.
- **Tidy up.** Write the day on a note ("Flyers out Wed 8 am", "周四下午4点试吃")
  and Tidy up springs every note into its day's column in a wave, notes
  without a time first, then by time. Notes that name no day get an ANY DAY
  column. Everything else lines up under the week. A second tidy keeps the
  week and sorts new notes into it. One undo takes it all back.
- **Follow someone.** Click a face in the top bar and your view follows theirs.
- **Export the week.** Copy it as Markdown for a chat, or download a CSV or an
  `.ics` calendar with timed and all-day events.
- **Works offline for a while.** Changes made while the connection is down are
  kept and sent when it comes back.
- **Phones.** One finger pans, two pinch, tools sit at the bottom.
- **Sample teammates.** On the example board, four made-up people can wander
  the board on your screen only, so one person can see what planning together
  looks like. They never change the board.

Keyboard: `V` select · `N` note · `P` pen · `T` heading · `C` checklist ·
`H` or hold `Space` to pan · `U` tidy up · `Enter` edit · `⌫` delete ·
`⌘D` duplicate · `⌘Z` / `⇧⌘Z` undo, redo · `+` `−` zoom · `⇧1` fit · `⇧0` 100%.

## Run it

Requires Node 20 or newer.

```sh
npm install
npm run dev:worker   # builds, then serves the app and live boards at http://localhost:8787
```

`npm run dev` serves the front end alone with hot reload; boards are then kept
in this browser (and shared between its tabs) instead of on a server.

## Test it

```sh
npm test             # unit tests: day and time reading, the tidy, checks, exports
npm run typecheck
npm run build && npm run e2e   # two browsers and a phone against a local Worker
```

The end-to-end run uses Playwright's Chromium (`npx playwright install chromium`
once if you do not have it). Point it at a deployed board with
`BASE_URL=https://… npm run e2e`.

## Deploy

Longtable runs on Cloudflare: a Worker serves the app and the API, and each
board is a [Durable Object](https://developers.cloudflare.com/durable-objects/)
with its own SQLite storage and hibernating WebSockets (works on the Workers
free plan).

```sh
npx wrangler login
npm run deploy
```

## How it is built

```
src/shared/   the model both sides share: items and ops (types.ts), the checks
              every incoming change passes (schema.ts), applying and undoing
              changes (state.ts), reading days and times (days.ts), the tidy
              (tidy.ts), exports (exporter.ts), the example board (templates.ts)
src/board/    the board in the browser: app.ts (state, actions, undo),
              views.ts (DOM per item), input.ts (pointer, touch, keys),
              editor.ts (typing), people.ts (cursors, reactions), chrome.ts
              (bars, dialogs), net.ts (WebSocket link with reconnect, or a
              local link for development), camera.ts and grid.ts
src/landing.ts  the front page
worker/       index.ts (API and static files) and room.ts (one board's room)
```

Every change is an op (`put`, `patch`, `del`, `vote`, `meta`). A browser
applies its own ops at once, keeps their inverse for undo, and sends them; the
room checks each op against the schema, applies it in arrival order, stores
it, and passes it to everyone else. Text, positions and colours are
last-writer-wins per field; votes are per person, so two votes never collide.
Presence (cursor, selection, what you are typing into, your view) is relayed
but never stored.

The look comes from the film: a dark canvas `#17181C` with a dot grid that
coarsens as you zoom out, notes in five sherbet colours with dark ink, Inter
for the interface, Bricolage Grotesque for the closing line, Caveat for
handwritten captions. All fonts are bundled from Fontsource (SIL Open Font
License).

## License

MIT. Pell & Rye, the people on its board and everything they plan are
fictional.
