# AGENTS.md

Guidance for AI coding agents working in this repo. (Claude Code reads this
via the `@AGENTS.md` import in `CLAUDE.md`.)

This is a self-hosted relay that forwards Discord messages to **Claude Code**
running on the host, and sends the reply back. Stack: Bun + React (Vite) +
Tailwind + `bun:sqlite` + discord.js (gateway). Only allowlisted Discord
users can talk to the bot; each DM, channel, and thread is its own Claude
session.

## Replying over Discord

Your final reply is posted as ordinary Discord messages, which render
**Discord-flavored Markdown** natively: headings (`#`–`###`), **bold**,
*italic*, ~~strikethrough~~, bullet and numbered lists, blockquotes, inline
code, and fenced code blocks with language tags all display properly.

Constraints that differ from GitHub Markdown:

- **No tables and no `---` horizontal rules** — Discord doesn't render them.
  Use bold headers + lists instead of tables; never hide the answer in one.
- Messages cap at **2000 characters**; the relay chunks longer replies on
  paragraph boundaries (code fences are kept valid across chunks), so just
  write normally.
- Bare URLs unfurl into a preview embed. That's usually nice; wrap a URL in
  `<angle brackets>` to suppress the preview when listing many links.
- To **mention someone**, include `<@THEIR_USER_ID>` in your reply (find the
  id with `bin/discord search-member` — see below). Writing `@name` as plain
  text does NOT ping anyone. `@everyone`/`@here` and role pings are always
  neutralized by the relay — don't try.

Every incoming message is prefixed with its Discord context (sender username
+ user id, channel name + id, server, thread if any) — use those ids directly
with `bin/discord` when the task needs them.

## Discord tools: `bin/discord`

Your hands on the Discord API (REST, bot token read from `data/app.db`, works
even while the relay is down). Compact JSON output.

```bash
bin/discord guilds                          # servers the bot is in → ids
bin/discord channels <guild_id>             # text channels → ids, names
bin/discord search-member <guild_id> andi   # find a user → id, username, nick
bin/discord messages <channel_id> 30        # recent messages, newest first
bin/discord send <channel_id> "text…"       # post to any channel/thread (or pipe stdin)
bin/discord dm <user_id> "text…"            # DM a user
bin/discord create-thread <ch> <msg> <name> # start a thread from a message
bin/discord react <ch> <msg> 👍             # add a reaction
```

Example — "mention Andi and tell him to check the dishwasher": get the guild
id (from the message context or `guilds`), `search-member <guild> andi` → id,
then `bin/discord send <channel_id> "<@THE_ID> please check out the dishwasher"`.

## Never send `localhost` / `0.0.0.0` URLs

The user reads your reply on their own device, not on this host — a URL
pointing at `localhost`, `127.0.0.1`, or `0.0.0.0` (e.g. the bind address a
dev server prints) is dead on arrival. Before sharing a URL to anything
running on this machine, resolve the host's reachable address and substitute
it.

**Always prefer the machine's full domain name over an IP address.** Get it
with `hostname -f` and use it in the URL whenever it resolves to a real,
publicly-reachable domain (contains a dot and isn't a bare local name like
`myhost` or `myhost.local`/`.localdomain`):

```bash
hostname -f                      # full domain name — USE THIS if it resolves
```

Only if `hostname -f` yields no usable domain, fall back to an IP:

```bash
curl -s ifconfig.me              # public IP (VPS reachable from anywhere)
hostname -I | awk '{print $1}'   # Linux: first LAN/VPN IP
ipconfig getifaddr en0           # macOS equivalent
```

Prefer whatever the user can actually reach (a VPS's DNS name over its IP; a
Tailscale/exe.dev MagicDNS name over a LAN IP for a home machine), keep the
port, e.g. `http://my-vps.example.com:5173/` — an IP like
`http://203.0.113.7:5173/` only as a last resort, and never
`http://0.0.0.0:5173/`.

## Bookmark every newly deployed app

The dashboard's homepage has a **Bookmarks** section — the user's launcher for
navigating between the apps you've built for them. **Whenever the user asks
you to create a new project and it ends up successfully deployed and running
on its own port, add it to the bookmarks** before you finish the turn:

```bash
bin/bookmark "http://$(hostname -f):3001"                    # title/favicon auto-fetched
bin/bookmark --title "My Notes App" "http://$(hostname -f):3001"   # explicit title
```

Rules:

- Use the same reachable-URL rules as for links in replies: full domain name
  from `hostname -f` when it's a real domain, IP only as a last resort —
  never `localhost`.
- Only bookmark apps that are actually up and reachable (the relay fetches
  the page's title and favicon when adding — a dead URL gets neither).
- `bin/bookmark` is idempotent per URL (re-running refreshes the title/icon
  instead of duplicating), works even while the relay is down (direct DB
  fallback), and also supports `--list` and `--remove <url-or-id>` — do that
  cleanup when the user asks to remove a project.
- If the app moves to a different port later, remove the old bookmark and add
  the new one.

Mention in your reply that the app was added to the dashboard's bookmarks.

## Messaging the user proactively (reminders, "tell me later")

The relay is purely reactive: each incoming Discord message spawns a one-shot
headless run (`claude -p`), and your process dies the moment your turn ends.
Harness timers (`ScheduleWakeup`, cron tools, background tasks) will **not**
fire after that — never rely on them here.

To push a message at any time, use:

```bash
bin/notify "your message"        # or pipe:  some-command | bin/notify
```

It reads the bot token from the relay's settings DB (`data/app.db`), so it
works even while the relay is down. Default target is the **owner's DM**;
`--channel <id>` targets any channel or thread instead. Messages are Markdown
(Discord-native); `--dry-run` prints the request instead of sending.

To say something **later**, schedule a detached job that outlives your turn
(same trick safe-update-relay uses). Use an absolute path — resolve it while
your turn is still alive, e.g. `N="$PWD/bin/notify"`:

```bash
# one-off in 2 minutes — survives your process exiting and pm2 restarts,
# but NOT a host reboot; use a job (below) for durable/recurring schedules:
setsid nohup bash -c "sleep 120 && \"$N\" '👋 2 minutes are up'" >/dev/null 2>&1 &
```

For "check X later and tell me" — a real agent turn, not canned text — have
the scheduled job run a fresh headless turn and pipe the result:

```bash
setsid nohup bash -c "sleep 7200 && cd $PWD && claude -p 'Check the deploy status of foo; summarize in 3 lines.' --permission-mode bypassPermissions 2>&1 | \"$N\"" >/dev/null 2>&1 &
```

Prefer a fresh session with a self-contained prompt over `--resume`: resuming
the relay's live session from a background job can race with a run the relay
starts at the same moment.

### Other local apps: push through `POST /api/notify`

When you build an app on this host that should alert the user over Discord,
don't give it its own bot plumbing — have it POST to the relay's
loopback-only notification gateway,
`http://127.0.0.1:<relay port>/api/notify` (body:
`{text, source, format?, kind?, context?, channel_id?}`). Read the
"Notification gateway" section of the README for the field contract before
wiring it up.

### Recurring checks ("watch X", "alert me when…"): write a script, register a job

When the user asks to watch/monitor/check something on a schedule, do **not**
schedule an agent prompt by default — every `claude -p` firing is a billed
agent turn. Instead, spend one turn (this one) writing a deterministic
watcher script and registering it as a **job** (`bin/job add`): the relay
runs it on a cron schedule and delivers its stdout to the job's Discord
channel for free. Escalate only as far up this ladder as the check actually
requires: pure script (free, covers most requests) → script detects +
`claude -p` only on trigger (bills a turn only when something happened) →
scheduled agent check (last resort — warn the user it bills every firing).

**Every job needs a delivery channel (`--channel <id>`), and the user must
have named it.** If they asked for a watcher without saying where the alerts
should go, **ask them which channel before registering** — never assume.
Resolve `#channel-name` → id via `bin/discord channels <guild_id>`; "DM me"
is also a valid answer (use the owner's DM channel id).

**Before writing or registering a job, read `docs/scheduled-jobs.md`** — it
has the full contract (stdout-is-the-message, `$STATE_FILE`, UTC schedules,
failure semantics), a worked example, and the `bin/job` management commands.

**Always close the loop in your reply** after creating a job: its name, the
schedule in the user's own terms and timezone, the delivery channel, exactly
what triggers a message ("you'll only hear from it when…"), and that saying
e.g. "remove the btc-alert job" stops it.

## Updating the relay itself

Never plain `pm2 restart` from a Discord-relayed turn — it kills the process
hosting your own run mid-reply. Update with the detached helper (pings the
owner's DM when done; a failed pull/build aborts before the restart):

```bash
setsid nohup ~/claude-code-discord/bin/safe-update-relay >/dev/null 2>&1 < /dev/null &
```

Env config (`RELAY_PROCESS_NAME`, `RELAY_REPO_DIR`), setup/install steps
(`bin/doctor` / `bin/install`) are in the README ("VPS setup" and
"Updating").
