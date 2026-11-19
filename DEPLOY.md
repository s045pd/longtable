# Run Longtable on your own Cloudflare account

You get the whole product on your account: boards saved on Cloudflare's
servers, live editing with everyone on a board, private links, passwords. It
all fits Cloudflare's **free plan**. No credit card is needed and no other
service is involved.

What runs where: one Worker serves the app and its API, and each board is a
[Durable Object](https://developers.cloudflare.com/durable-objects/) with
its own SQLite database. Boards stay in your Cloudflare account. Nothing is
sent anywhere else.

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

**Deploy to Cloudflare button.** Once the Longtable repository is public,
its README has a button that does all of this from the browser. It copies the
code into your GitHub account and deploys it, so you don't need a token or
Node.

**By hand.** `npx wrangler login`, then `npm install` and `npm run deploy`.

## Who can get in

- **Starting boards.** By default anyone who knows your Longtable's address
  can start a board on it. To keep that to your team, set a **team
  password**. Setup asks for it. Or add a secret named `CREATE_PASSWORD`
  under *Workers → your worker → Settings → Variables and Secrets*. People
  you send a board link to never need it.
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
  - **Make new links.** The old links stop working at once, and everyone
    else leaves the board until they get the new one.
  - **Copy the owner link**, to manage the board from another device.
  - **Clear** the board (Undo brings it back) or **delete** it. Deleting
    removes it from the server for good, and anyone on the board sees that
    it's gone.
- Anyone can choose **Forget this board here** to take it off their own
  device.

To put the whole site behind your company login (Google, Microsoft, email
codes…), add [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/)
in front of it. It's free for up to 50 users.

## Your own domain

*Workers → your worker → Settings → Domains & Routes → Add → Custom domain*,
for example `plan.example.com`. The domain has to be on the same Cloudflare
account.

## What the free plan covers

The free plan resets every day at 00:00 UTC. If a limit runs out, boards stop
answering until the reset. Nothing is lost. For more, Workers Paid is
$5 a month.

| Limit per day | What uses it | Roughly |
| --- | --- | --- |
| 100,000 Worker requests | opening a board and starting one (the app's files are free) | thousands of visits |
| 100,000 Durable Object requests | cursor moves and edits: 20 messages count as one request | about 50 hours of people actively working |
| 13,000 GB-s of Durable Object time | a board only counts while people are doing something; open but idle tabs cost nothing | about 28 hours of active boards |
| 100,000 rows written | each changed note is written at most once a second | plenty for a team |
| 5 GB stored | a board is about 50–200 KB | tens of thousands of boards |

In practice the free plan covers a team of 10 to 20 people who plan together
for a couple of hours a day.

## Where your data is

Everything on a board is stored in the board's Durable Object in your
Cloudflare account. Cloudflare encrypts it at rest. Deleting a board erases
its storage. All that's left is the date it was deleted, so its link can say
so. Cursors, selections and who is online are passed between people but
never stored.
