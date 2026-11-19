# Security

Longtable keeps people's plans private, so security reports are welcome and
taken seriously.

## Reporting a problem

Please report it privately: open the repository's **Security** tab and choose
**Report a vulnerability**. Don't open a public issue for it.

It helps to include:

- what someone could do (for example, open a board without its link, change a
  board with a watch link, or get past a password);
- the steps to show it, against your own deployment or `npm run dev:worker`;
- the version or commit you tested.

You'll get an answer within a week. Once a fix is out, the report can be made
public, with credit if you'd like it.

## What counts

- Getting into a board, or learning anything on it, without one of its links.
- Changing a board with a watch link, or doing owner things without the
  owner link.
- Getting past a board's password, the wait after wrong tries, or a
  deployment's team password.
- Anything that leaks a board's keys, a password or a pass to the server's
  logs, another site or another person.
- Cross-site scripting or other ways to run code in someone's board.

Running out a deployment's free Cloudflare quota on purpose is a known limit
of the free plan rather than a vulnerability, but ideas to make it harder are
welcome.

## How boards are protected

[README → Private by default](README.md#private-by-default) and
[DEPLOY.md → Who can get in](DEPLOY.md#who-can-get-in) describe the access
model: link keys, the owner key, passwords and the wait after wrong tries.
