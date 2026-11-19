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
- **Private by default.** A board's address alone opens nothing: its links
  carry a secret key after the `#` (which never reaches a server). Share an
  edit link, or a watch link that can look, point and react but never
  change anything. Whoever starts a board owns it and can add a password,
  change it, make new links (the old ones stop working at once), clear the
  board or delete it from the server for good. Wrong passwords are slowed
  down; the password is kept only as a salted hash.
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
- **Pick the day by hand.** Select notes and press **Day** (or `D`, or click
  the date on a note) to pick a day of the board's week, with its real date,
  and a time. Or drag a note into a column of the week: it takes that day and
  slots in. A picked day wins over the words and shows as a stamp on the note;
  "Read from the words again" undoes the pick.
- **The front page is the demo.** Opening Longtable (`/`, also `/demo`)
  plays the whole story on a board of its own, in your tab only, where five
  made-up people play out the whole story by themselves. They join one by one,
  write, draw, drop photos, tick and vote at once while the camera follows the
  busiest corner, two of them pull at the same note, and Ana selects
  everything and presses Tidy up. Esc stops it and hands the board to you;
  nothing there is saved. Afterwards: replay it, make your own board (the
  example or a blank one) or open one of yours. Every board has a "Play the
  demo" button in its corner; with reduced motion the front page shows the
  tidied week and waits for Play. The written introduction is at `/about`.
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
npm run build && npm run e2e   # several browsers and a phone against a local Worker
```

The end-to-end run uses Playwright's Chromium (`npx playwright install chromium`
once if you do not have it). It covers the privacy rules too: keyless and
made-up links, the watch link (also against a script talking to the server
directly), passwords and the wait after wrong ones, new links, clear, delete,
the team password and the security headers. Point it at a deployed
Longtable with `BASE_URL=https://… npm run e2e` (add `TEAM_PASSWORD=…` if it
has one).

## Deploy your own

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/s045pd/longtable)

Longtable runs on Cloudflare's free plan: a Worker serves the app and the
API, and each board is a
[Durable Object](https://developers.cloudflare.com/durable-objects/) with its
own SQLite storage and hibernating WebSockets. With one Cloudflare API token:

```sh
npm run setup      # asks for the token, then installs, builds, deploys and prints your address
```

[DEPLOY.md](DEPLOY.md) has the token link (the two permissions it needs,
filled in), the GitHub Actions way, the team password, your own domain,
what the free plan covers, and where the data lives. (The button works once
the repository is public.)

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
              local link for development), camera.ts and grid.ts, and
              demo.ts (the front page's demo, played with all of the above)
src/landing.ts  the written introduction (/about)
worker/       index.ts (API and static files), room.ts (one board's room) and
              access.ts (its keys, password and the wait after wrong tries)
scripts/      deploy-cloudflare.mjs (npm run setup)
```

Every change is an op (`put`, `patch`, `del`, `vote`, `meta`). A browser
applies its own ops at once, keeps their inverse for undo, and sends them; the
room checks each op against the schema, applies it in arrival order, passes
it to everyone else, and writes what changed to storage at most once a second
(so a drag is one write, not hundreds). Text, positions and colours are
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
