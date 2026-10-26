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

## Answer first; never let long work eat the reply

Your run is a one-shot `claude -p`: a Bash tool call is killed at **5
minutes** (the relay caps it; `timeout` won't buy more), background commands
die the moment your turn ends, and whatever you write as your final message
is the *only* thing the user gets. Worse, **any message the user sends while
you are still working kills your run** — a nudge like "what took so long?"
after six quiet minutes aborts the turn, nothing is posted, and the user is
still waiting for the original answer. (The replacement prompt then carries a
relay note telling you so — answer them with what you have.) The relay also
catches turns that end with a stub ("No response requested.") and posts a
"finished without answering" notice, but that is damage control, not the
plan.

Rules, in order:

1. **Answer the question before starting anything slow.** If the message
   contains a question you can answer now (from what you know, a quick
   lookup, a `bin/discord`/`git`/`ls` call), write that answer into your
   final reply *first*, and only then decide whether extra work is needed.
   Never make the answer wait on a build, deploy, test suite, sync, or
   download.
2. **Anything that might exceed ~5 minutes runs detached, not in the
   foreground.** Builds, full test suites, backfills, large downloads,
   model/package installs, scrapes — kick them off with `setsid nohup` so
   they outlive your turn, and have the job itself report back to the
   conversation with `bin/notify --channel <id>` when it finishes (the
   channel/thread id is in the Discord context line at the top of the
   message; for a DM use `bin/notify` with no `--channel`). Resolve absolute
   paths while your turn is alive:

   ```bash
   N="$PWD/bin/notify"; CH=<channel or thread id from the context line>
   setsid nohup bash -c "
     cd /path/to/project
     if bun run build > build.log 2>&1; then
       \"$N\" --channel $CH '✅ Build finished — ready to test.'
     else
       { echo '❌ Build failed. Last lines:'; tail -20 build.log; } | \"$N\" --channel $CH
     fi
   " >/dev/null 2>&1 < /dev/null &
   ```

   Then **say in your reply that it is running detached and will report
   back here**, with a rough ETA. Do not poll or `sleep` waiting for it.
3. **Never end a turn with a non-answer.** "No response requested.", "Done."
   with nothing else, or an empty message are failures. If a tool call was
   killed at its time limit, say so and say what you did about it (restarted
   detached, or what the user should decide). If you genuinely have nothing
   to add, confirm what the user said in one line instead of staying silent.
4. If a long command is unavoidable in the foreground (it must finish before
   you can answer), tell the user up front in a short interim line via
   `bin/discord send <channel_id> "…"` that it will take a while, keep the
   command itself under the cap (`timeout 240 …`), and still write a real
   final reply even if it gets cut off.

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

## Deploying apps and PR previews on this host — use `bin/preview`

The host is a small VM. Every server you start under pm2 keeps running after
your turn ends, and nothing reaps it — six forgotten PR previews once ate the
RAM and made the bot look dead for an afternoon. So:

- **Start throwaway servers (PR previews, demos, "show me it running") with
  `bin/preview`, never with bare `pm2 start`.** It names the process
  `preview-<name>` (re-deploying the same name restarts it instead of adding
  a sibling), gives it a TTL (default 3 days) and a memory cap, and
  **refuses to start when the host is low on memory or already runs 4
  previews** — then stop or `gc` something first; don't `--force` past it
  unless the user says so.

```bash
bin/preview start shop-pr-42 --cwd ~/shop --port 3042 -- bun run dev
bin/preview list                 # what's running, age, memory, when it expires
bin/preview stop shop-pr-42      # the PR is merged / the user is done
bin/preview gc                   # reap expired previews (gc --all: everything)
bin/preview check                # memory guard only; exit 2 when low
```

- **Check memory before starting any new long-running process**, preview or
  not: `bin/preview check` (or `free -m`). If it's low, stop stale things
  (`bin/preview gc`, `pm2 ls` → `pm2 delete <name>`) before adding more, and
  say in your reply what you stopped.
- **Previews are ephemeral.** Stop one as soon as its purpose is served (the
  user said "looks good", the PR merged, the demo is over). Bookmark only
  durable apps (next section), never previews.
- **Durable apps** (the user asked for "an app", not a preview) still go
  under pm2, but with a deterministic `--name`, `--max-memory-restart`, and
  `pm2 save` afterwards; one process per app — restart it, don't start a
  twin on a new port.
- If the relay tells you the host is low on memory (a warning at the top of
  your prompt naming the heaviest processes), treat the cleanup as part of the
  task before doing anything else that spawns processes.
- For automatic cleanup, `bin/preview gc` can be registered as a job
  (`docs/scheduled-jobs.md`) — only if the user asks, and with their channel.

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
- Only bookmark **durable** apps. PR previews and other throwaway servers
  started with `bin/preview` get reaped, so a bookmark to one goes dead.
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
`--channel <id>` targets any channel or thread instead — when the user asked
in a channel or thread, report back there (its id is in the Discord context
line), not to their DM. Messages are Markdown (Discord-native); `--dry-run`
prints the request instead of sending.

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

## Adding MCP servers, connectors and skills from Discord

The user has no SSH and no terminal on this host — everything interactive
must finish from their own device. The dashboard's **Capabilities** page tells
them to just ask you, so handle these requests end to end:

- **Account connectors** (`claude.ai …` entries in `claude mcp list`: Gmail,
  Drive, Notion, …) follow the user's Claude account, not this machine. If
  one is missing or "Needs authentication", tell them to connect/authorize it
  in claude.ai or Claude Desktop → Settings → Connectors. Nothing to install.
- **Per-machine MCP servers**: `claude mcp add -s user --transport http <name>
  <url>` (user scope, so it's available regardless of cwd). If the server
  needs OAuth, **use the `pty-oauth-login` skill** to drive
  `claude mcp login --no-browser <name>` — never run it as a plain
  subprocess (it dies with "stdin isn't a terminal" or hangs). The printed
  URL is wrapped in an OSC-8 hyperlink, so a naive ANSI strip yields it
  **twice back-to-back** — cut at the second `https://`. Send it wrapped in
  `<angle brackets>` (no embed), tell the user to open it and paste back the
  full redirect URL (a `localhost:…` URL is expected — that's what they should
  paste), write it to the FIFO followed by a separate `\r`, then confirm with
  `claude mcp list`. Same flow for "sign in to the X MCP server" (works for
  plugin servers like `plugin:posthog:posthog` too). `bin/install` installs
  `pty-oauth-login`; if it's missing, install it first (see below).
- **Skills**: `npx -y skills@latest add <owner/repo> --skill <name> -g -y
  -a claude-code` → lands in `~/.claude/skills/<name>`. Plugins: `claude
  plugin install <name>@<marketplace>`.

Close the loop: say what was added/signed in, that the Capabilities page shows
it (Refresh re-checks MCP connections), and give the dashboard URL.

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
