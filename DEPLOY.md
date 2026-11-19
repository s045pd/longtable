# Run Longtable on your own Cloudflare account

You get the whole product on your account: boards saved on Cloudflare's
servers, live editing with everyone on a board, private links, passwords. It
all fits Cloudflare's **free plan**. No credit card is needed and no other
service is involved.

What runs where: one Worker serves the app and its API, and each board is a
[Durable Object](https://developers.cloudflare.com/durable-objects/) with
its own SQLite database. Pasted chats are read by
[Workers AI](https://developers.cloudflare.com/workers-ai/) on the same
account. Boards stay in your Cloudflare account. Nothing is sent anywhere
else.

## The easiest way: one token, one command

You need a Cloudflare account (free) and [Node.js](https://nodejs.org) 20 or
newer.

1. **Make an API token.** Open this link while signed in to Cloudflare. It
   fills in the two permissions Longtable needs:

   <https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%5D&accountId=*&zoneId=all&name=Longtable%20deploy>

   Check that it lists **Account · Workers Scripts · Edit** and **Account ·
   Account Settings · Read**. Under Account Resources, pick your account,
   then click *Continue to summary* and *Create Token*, and copy the token.
   (If the link doesn't fill anything in: *Create Token* → template **Edit
   Cloudflare Workers** works too, it just allows more.)

2. **Run the setup** in the Longtable folder:

   ```sh
   npm run setup
   ```

   Paste the token when it asks. The token isn't shown, and it is never
   saved. Setup finds your account and asks for a name (default
   `longtable`). It also asks for an optional team password (see below).
   Then it installs, builds, deploys and checks the result. At the end it
   prints your address, `https://longtable.<your-subdomain>.workers.dev`.

That's it. To update to a newer Longtable, get the new code and run
`npm run setup` again. Your boards stay as they are.

Without questions, for scripts:

```sh
CLOUDFLARE_API_TOKEN=… npm run setup -- --yes --name longtable --team-password '…'
```

## Other ways

**From GitHub, without a computer.** Put the code in a repository of your
own. Under *Settings → Secrets and variables → Actions*, add the secret
`CLOUDFLARE_API_TOKEN` (the token from step 1). You can also add the secrets
`LONGTABLE_TEAM_PASSWORD` and `CLOUDFLARE_ACCOUNT_ID`. Then go to *Actions →
Deploy to Cloudflare → Run workflow*. To deploy on every push to `main`, add
the repository variable `AUTO_DEPLOY` = `true`.

**Deploy to Cloudflare button.** The README's button does all of this from
the browser: it copies the code into your GitHub account and deploys it, so
you don't need a token or Node. It works only while the Longtable repository
is public.

**By hand.** `npx wrangler login`, then `npm install` and `npm run deploy`.

## Who can get in

- **Starting boards.** By default anyone who knows your Longtable's address
  can start a board on it. To keep that to your team, set a **team
  password**. Setup asks for it. Or add a secret named `CREATE_PASSWORD`
  under *Workers → your worker → Settings → Variables and Secrets*. People
  you send a board link to never need it. Either way, one address can start
  at most 30 boards an hour, so a script can't use up the day's free quota.
- **Opening a board.** Only someone with one of the board's links gets in.
  The board's address alone opens nothing. The secret part of the link comes
  after the `#`, and browsers never send that part to a server, so it stays
  out of logs. Boards aren't listed or searchable anywhere, and every page
  tells search engines not to index it.
- **Edit link and watch link.** *Share* shows both. The watch link shows
  everything live, but it can't change the board. The server refuses any
  change sent with a watch link.
- **The owner.** Whoever starts a board owns it. The owner can do these
  things from *Share → Board settings*:
  - Set, change or turn off a **password**. Everyone else needs the password
    once on each device. Changing it sends everyone else to the password
    screen, including people who are on the board right then. After five
    wrong tries the board makes you wait, from 30 seconds up to 15 minutes.
    The password is stored only as a salted PBKDF2 hash.
    The count of wrong tries is kept for a day in the board's storage, under
    a hash of the address rather than the address itself.
  - **Make new links.** The old links stop working at once, and everyone
    else leaves the board until they get the new one.
  - **Copy the owner link**, to manage the board from another device.
  - **Clear** the board (Undo brings it back) or **delete** it. Deleting
    removes it from the server for good, and anyone on the board sees that
    it's gone.
- **Calendar link.** *Export week → Keep it in your calendar* hands out a
  third link, for calendar apps. It has a key of its own and can only read
  the notes that name a day, as an `.ics` feed. Making new links or setting
  or changing the password switches the old calendar link off; subscribed
  calendars then stop updating until someone subscribes to the new one.
- **MCP address.** *Share → Plan with an AI assistant* hands people who can
  edit a fourth link, for AI assistants (see below). It has a key of its own
  and can change the board like the edit link. New links or a new password
  switch it off.
- Anyone can choose **Forget this board here** to take it off their own
  device.

To put the whole site behind your company login (Google, Microsoft, email
codes…), add [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/)
in front of it. It's free for up to 50 users.

## Reading chats with Workers AI

*Paste the group chat, get a plan* works as soon as Longtable is deployed:
the `ai` binding in `wrangler.jsonc` connects the Worker to Workers AI on
your account. The setup token doesn't need any extra permission for it.

- **Model.** `@cf/qwen/qwen3-30b-a3b-fp8`, which reads Chinese and English
  well and is cheap. It thinks before it answers, so a chat takes about 5 to
  30 seconds. To try another
  [text model](https://developers.cloudflare.com/workers-ai/models/), add a
  variable `AI_MODEL` under *Workers → your worker → Settings → Variables
  and Secrets*.
- **Cost.** Workers AI gives every account 10,000 *neurons* a day for free.
  One group chat uses about 40 to 80, so that's around 150 chats a day. Each
  answer's token and neuron count is written to the Worker's logs (never the
  chat itself).
- **When it runs out,** the dialog says so and turns each line into a note
  instead, until the allowance resets at 00:00 UTC. On Workers Paid you get
  the same 10,000 free and pay for the rest. One address can ask 20 times an
  hour on a board, so nobody spends the day's allowance alone.
- **Privacy.** The chat goes from the board's room to Workers AI and back,
  inside your Cloudflare account. It is never stored or logged; only the
  notes someone chooses to add are kept. A watch link can't send a chat.
- **To turn it off,** delete the `ai` block from `wrangler.jsonc` and deploy
  again. Pasting a chat then always makes one note per line.

## Calendar feeds

Each board's feed is
`https://<your Longtable>/api/boards/<board>/cal/<key>.ics`. The buttons
under *Keep it in your calendar* subscribe Google Calendar, Apple Calendar
or Outlook to it, and *Copy link* is there for anything else that takes a
calendar address. The feed holds every note that names a day, as timed or
all-day events: a note with a date of its own on that date, the others in
the board's week. Add `?who=<name>` and it holds only that person's notes
(tagged with the name or saying “@name”); *Just mine* in the dialog does
this for you. `?tz=<zone>` sets the time zone of the times. It asks calendars to
look again every hour and keeps each event's id, so a moved note moves in
the calendar rather than appearing twice. How often a calendar really looks
is up to it: Apple and Outlook within hours, Google sometimes only once a
day. A deleted board's feed answers *410 Gone*, and calendars drop it.

## AI assistants (MCP)

Each board answers the [Model Context Protocol](https://modelcontextprotocol.io)
at `https://<your Longtable>/api/boards/<board>/mcp/<key>`: Streamable HTTP,
JSON answers, no sessions, and CORS open so browser-based clients work too.
Its tools read the board (`read_board`, `week_as_text`), change it
(`add_notes`, `update_note`, `delete_notes`, `tidy_up`), give out the
calendar (`calendar_link`) and draw the week (`week_picture`). Changes go to
everyone on the board live, through the same checks as anyone's edits.
One address can make 600 requests an hour to a board.

- **Pictures** need [Browser Rendering](https://developers.cloudflare.com/browser-rendering/),
  which the `browser` binding in `wrangler.jsonc` connects. A headless browser
  opens the site's own `picture.html` and draws the week exactly like
  *Export → Picture*. The free plan gives 10 minutes of browser time a day
  and starts one browser every 20 seconds; a picture takes 3 to 6 seconds,
  so that's about a hundred a day. A board can have 20 pictures an hour.
  When the allowance is used up, or without the binding, the assistant gets
  the week as text instead.
- **To turn pictures off,** delete the `browser` block from `wrangler.jsonc`
  and deploy again. The rest of MCP keeps working. Do the same if a deploy
  ever stops at the `browser` binding.

## Your own domain

*Workers → your worker → Settings → Domains & Routes → Add → Custom domain*,
for example `plan.example.com`. The domain has to be on the same Cloudflare
account.

## What the free plan covers

The free plan resets every day at 00:00 UTC. If a limit runs out, boards stop
answering until the reset. Nothing is lost. (The Workers AI allowance is the
exception: when it runs out, only reading chats stops, and pasting a chat
makes one note per line.) For more, Workers Paid is $5 a month.

| Limit per day | What uses it | Roughly |
| --- | --- | --- |
| 100,000 Worker requests | opening a board and starting one (the app's files are free) | thousands of visits |
| 100,000 Durable Object requests | cursor moves and edits: 20 messages count as one request | about 50 hours of people actively working |
| 13,000 GB-s of Durable Object time | a board only counts while people are doing something; open but idle tabs cost nothing | about 28 hours of active boards |
| 100,000 rows written | each changed note is written at most once a second | plenty for a team |
| 5 GB stored | a board is about 50–200 KB | tens of thousands of boards |
| 10,000 Workers AI neurons | reading pasted chats, about 40 to 80 a chat | about 150 chats |
| 10 minutes of Browser Rendering | pictures for AI assistants, 3 to 6 seconds each | about 100 pictures |

A subscribed calendar looking for changes costs one Worker request and one
Durable Object request, so even 100 calendars checking every hour use only a
few percent of the day.

In practice the free plan covers a team of 10 to 20 people who plan together
for a couple of hours a day.

## Where your data is

Everything on a board is stored in the board's Durable Object in your
Cloudflare account. Cloudflare encrypts it at rest. Deleting a board erases
its storage. All that's left is the date it was deleted, so its link can say
so. Cursors, selections and who is online are passed between people but
never stored. Addresses are never stored either: counting wrong passwords
and new boards uses a short hash of the address, forgotten within a day.
