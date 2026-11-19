# Contributing

Thanks for wanting to make Longtable better. Bug reports, ideas and pull
requests are all welcome.

## Before you start

- **Bugs:** open an issue with what you did, what you expected and what
  happened, plus the browser and device. Screenshots help.
- **Security problems:** please don't open an issue. Follow
  [SECURITY.md](SECURITY.md) and report it privately.
- **Bigger changes:** open an issue first, so we can agree on the shape
  before you spend time on it.

## Making a change

```sh
npm install
npm run dev:worker      # the whole app with a real board server, on this machine
npm run typecheck
npm test                # unit tests
npm run e2e             # two browsers and a phone on a live board
```

Keep pull requests focused on one thing, and add or update a test for what
you change. User-facing text is plain English; README changes go in both
README.md and README.zh-CN.md.

## Licence of your contribution

Longtable is released under the [AGPL-3.0](LICENSE). By sending a pull
request you confirm that you wrote the change (or have the right to submit
it), and you agree that:

1. your contribution is licensed to everyone under the AGPL-3.0, like the
   rest of the project; and
2. s045pd may also use, change and license your contribution under other
   terms, including in a hosted or commercial edition of Longtable.

You keep the copyright in your work. If you can't agree to point 2, say so in
the pull request before it is merged.
