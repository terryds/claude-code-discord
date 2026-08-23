# claude-code-discord-coworker

A tiny relay that forwards Discord messages to [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) running on your VPS, and sends the agent's response back. Self-hosted, allowlist-gated, no external services beyond Discord and your local CLI.

- **Stack**: [Bun](https://bun.sh) + React (Vite) + Tailwind + Wouter + `bun:sqlite` + [discord.js](https://discord.js.org) (gateway only)
- **No vendor SDK for the agent** — spawns your local `claude` CLI (inherits its auth)
- **Session per conversation** — each DM, channel, and thread is its own `claude --resume` session; **new threads always start fresh**, so context stays contained in the thread
- **Channel response modes** — *free responses* (default: just talk, no mention needed; end a message with ` /t` to branch into a thread), *mention → thread* (Hermes-style: @mention the bot, it replies in a new thread), or *ignore* — per channel, from the dashboard
- **Allowlist** — only approved Discord users can drive the agent; the person who completes onboarding becomes the owner
- **Commands both ways** — plain text (`/stop`, `/new_session`, …) and native slash commands with autocomplete and ephemeral replies
- **Model & effort switch** — pick the Claude model (`fable`/`opus`/`sonnet`/`haiku` or any full id) and reasoning effort from the dashboard or `/model` / `/effort`
- **Agent Discord tools** — the agent can search members, read channels, send messages, create threads, and react via `bin/discord` ("mention Andi and tell him…") 
- **Scheduled jobs** — ask the agent to "watch X and alert me in #channel" and it writes a watcher script and registers it on a cron schedule with that channel as the delivery target; no billed agent turn per check (see `/jobs`, the dashboard card, and [docs/scheduled-jobs.md](docs/scheduled-jobs.md))
- **Gateway is outbound-only** — the bot opens a WebSocket to Discord; nothing connects inbound to your machine, so it works behind NAT/VPN/private hosts (exe.dev, Tailscale) with no open ports

## Prerequisites

- [Bun](https://bun.sh) `>= 1.3.12`
- **Claude Code** installed on the machine that runs the relay — [install](https://docs.claude.com/en/docs/claude-code/overview); `claude --version` must work. You can **authenticate it from the dashboard** during onboarding (see [Authentication](#authentication)), so it only needs to be on PATH.
- `python3` — only for Claude's in-dashboard subscription sign-in (it drives a PTY). `bin/install` installs it; skip if you authenticate Claude another way.
- A Discord application + bot — created in the [Discord Developer Portal](https://discord.com/developers/applications) (onboarding walks you through it, ~2 minutes).

## Local development

```bash
bun install
bun run dev
```

This launches the server (port `8100`, hot-reload) and Vite (port `5173`, proxying `/api` to the server). Open <http://localhost:5173>.

You'll be sent to `/onboarding`:

1. **Authenticate Claude Code.** The page verifies the CLI is installed, then checks whether it's signed in. If not, pick **Subscription** (sign in straight from the dashboard — no terminal) or **API key** (paste a key; it's stored and injected when the relay runs). See [Authentication](#authentication).
2. **Create your Discord bot.** Follow the steps on the page:
   1. [Developer Portal](https://discord.com/developers/applications) → **New Application** → name it → Create.
   2. **Bot** tab → under *Privileged Gateway Intents*, toggle ON **Message Content Intent** and **Server Members Intent** → Save. (Skipping Message Content Intent is the #1 cause of a bot that connects but never answers.)
   3. **Reset Token** → copy (shown once) → paste into the dashboard.
   4. The dashboard then shows a generated **invite link** (right scopes and permissions pre-filled) — open it, pick your server, **Authorize**. No server yet? Create one first; it can be just you and the bot.
3. **Say hi.** Click **Start listening**, then send the bot any message (in the server, or a DM). The first message links you as the **owner** — the first entry of the allowlist — and the bot replies with a welcome.

After that you're on the dashboard: channel modes, allowlist, model/effort, persona, bookmarks, scheduled jobs, auth, updates, and a live activity feed.

## Channels, modes, and threads

Every guild text channel has a **response mode** — a per-channel override or the global default (out of the box: `free`):

- **Free responses** (default) — the bot answers every allowlisted user's message inline, no mention needed. End a message with ` /t` (or ` /thread`) and the bot instead creates a **thread** from it and answers there, with a **fresh session** — great for branching off a side-task without polluting the channel conversation.
- **Mention → thread** — the bot only reacts when you @mention it; it creates a thread from your message (named after its first words) and replies inside, again with a fresh session. Messages that mention someone else (not the bot) are left alone.
- **Ignored** — the bot never responds in the channel.

Regardless of mode: **DMs always answer**, and once the bot is in a thread it keeps answering there without a mention. Each DM / channel / thread is its **own conversation** with its own Claude session — contexts don't bleed. Conversations run **concurrently**; within one conversation it's one task at a time (a new message auto-stops that conversation's current run). Careful with two conversations editing the same project simultaneously — the relay doesn't referee file conflicts.

Every message reaching the agent is prefixed with its Discord context (sender username + id, channel + id, server, thread) so the agent knows who and where it's talking to — and can act on those ids with `bin/discord`.

## Allowlist

Only allowlisted users can talk to the bot; everyone else is silently ignored. The onboarding user is the owner (can't be removed). Add more people from the dashboard's **Allowed users** card: enable Developer Mode in Discord (Settings → Advanced), right-click a user → **Copy User ID**, paste it in.

> ⚠️ Every allowlisted user can drive a shell-capable agent on your machine — see [Security](#security).

## Authentication

The relay spawns your local `claude` CLI, so that CLI has to be authenticated. Onboarding (and the dashboard's auth panel) detect this and offer two methods, switchable anytime:

- **Subscription** — sign in with your Claude plan from the dashboard, no terminal: it drives `claude auth login` (this is why `python3` is needed — it runs the CLI in a PTY). Click **Sign in with Claude** and authorize in your browser; the CLI detects completion on its own (pasting the code the page shows is a fallback). This signs in the host's `claude` itself, so the CLI also works outside the relay.
- **API key** — paste an Anthropic key. It's stored in `data/app.db` and injected as `ANTHROPIC_API_KEY` when the relay runs (pay-per-token API billing, not your subscription).

Detection is cheap — `claude auth status`, no model call. You can also authenticate the CLI yourself on the host (`claude auth login`) and the relay will pick it up.

## Production build

```bash
bun run build   # builds the client into dist/client/
bun start       # starts the server on PORT (default 8100), serving API + client
```

The single Bun process serves `/api/*`, the static React build, and the Discord gateway connection on one port. Override with `PORT=8080 bun start`.

## VPS setup with pm2

These steps assume Ubuntu/Debian. Adjust paths as needed.

### 1. Install dependencies

```bash
bin/install        # installs anything missing (Ubuntu/Debian, uses sudo)
bin/doctor         # read-only: report what's present / missing
```

`bin/install` is idempotent and **does not** touch the Claude CLI — install it yourself (`npm install -g @anthropic-ai/claude-code`, or see the docs). You don't have to log it in here: authentication can be done from the dashboard during onboarding.

### 2. Clone and build

```bash
cd ~
git clone https://github.com/terryds/claude-code-discord.git claude-code-discord
cd claude-code-discord
bun install
bun run build
```

### 3. Start under pm2

```bash
cd ~/claude-code-discord
PORT=8100 pm2 start server/index.ts \
  --name claude-code-discord-coworker \
  --interpreter "$(which bun)" \
  --max-restarts 10 \
  --restart-delay 3000

pm2 save
pm2 startup   # follow the printed instruction to enable on boot
```

`pm2 save` snapshots the env that was current at start time, so `PORT` persists across `pm2 resurrect` and reboots. If you change an env var later, restart with `pm2 restart claude-code-discord-coworker --update-env`.

### 4. Expose the dashboard

The dashboard has no authentication — it's intended to sit behind something:

- An SSH tunnel (`ssh -L 8100:localhost:8100 your-vps`) — simplest, no public exposure
- A private overlay network (Tailscale, exe.dev private mode) — the relay itself needs **no inbound port** for Discord, so this works fully
- A reverse proxy with HTTP basic auth if you must expose it publicly

### 5. Onboard

Visit the dashboard, complete the three onboarding steps, and you're live. Message your bot — it reaches Claude Code on the VPS and replies.

## Updating

```bash
cd ~/claude-code-discord
git pull
bun install            # if dependencies changed
bun run build          # rebuild the client
pm2 restart claude-code-discord-coworker
```

Your bot token, owner link, allowlist, channel modes, and sessions live in `data/app.db` — they survive restarts and code updates.

### Updating from Discord

If you ask the relayed agent itself to update the project, a plain `pm2 restart` kills the process hosting the conversation mid-reply. The repo ships [`bin/safe-update-relay`](bin/safe-update-relay): it detaches, delays briefly, runs `git pull` → `bun install` (if deps changed) → `bun run build` → `pm2 restart`, waits for the process to come back online, and DMs you the result. A failed pull/build aborts before the restart. The `/update` command and the dashboard's Updates card both use it.

```bash
setsid nohup ~/claude-code-discord/bin/safe-update-relay >/dev/null 2>&1 < /dev/null &
```

Config via env vars: `RELAY_PROCESS_NAME` (default `claude-code-discord-coworker`), `RELAY_REPO_DIR` (default: the repo the script lives in).

## Commands

Available both as plain text and as native slash commands (registered per-guild, so they appear instantly):

- `/help` — show usage
- `/stop` — interrupt the agent (kills that conversation's in-flight run)
- `/new_session` — fresh conversation *here* (other channels/threads keep their context)
- `/model` — show or set the Claude model (`fable`, `opus`, `sonnet`, `haiku`, or a full id; `default` clears)
- `/effort` — show or set reasoning effort (`low`…`max`)
- `/persona` — show or customize the assistant persona
- `/skills` — list the agent skills available on this host
- `/jobs` — list scheduled watcher jobs
- `/update` — pull the latest relay version, rebuild, restart

Slash-command replies are ephemeral (only you see them). Text commands answer in place.

### Interrupting a run

The agent streams its progress (thinking, tool calls, results) into the conversation as it works, and the gateway keeps receiving the whole time. Send `/stop` to cancel that conversation's run, or just send a new prompt — it auto-stops the running task and starts the new one. Stopping is a hard process kill: file edits already made stay on disk; the interrupted turn isn't saved to the session.

## Attachments

Images, audio, video, and any other file you attach are downloaded to `data/incoming/<attachment_id>-<name>` and the local path (plus MIME type) is appended to the prompt — Claude reads images/text/PDFs with its `Read` tool and handles the rest with its own tools (ffmpeg, transcription, …). Discord's standard 25 MB upload limit applies. Files are not auto-deleted — wipe `data/incoming/` periodically if you don't want them around.

## Notification gateway (`POST /api/notify`)

Other apps on the same host can push Discord alerts through the relay
instead of carrying their own bot credentials:

```bash
curl -s -X POST http://127.0.0.1:8100/api/notify \
  -H 'Content-Type: application/json' \
  -d '{"text": "**2 drafts ready**", "source": "myapp",
       "kind": "draft digest", "context": "2 drafts ready: …"}'
```

- `text` (required) — the message; `source` (required) — who sent it, labels
  it in the dashboard feed (`[myapp] …`).
- `kind` (optional) — what kind of alert it is (e.g. `"draft digest"`,
  `"deploy status"`); shown alongside the source in the feed and in the
  agent's FYI list, so the agent knows who triggered the alert *and* what
  it's about.
- `channel_id` (optional) — deliver to a specific channel/thread instead of
  the owner's DM. The agent-context note is queued for *that* conversation.
- `format` — `"md"` (Discord-native Markdown, default), `"plain"` (same),
  or `"html"` (accepted for compatibility with the Telegram relay's payloads
  — b/i/a/code tags are converted to Markdown, so links survive as
  `[label](url)`; other tags are stripped).
- `context` (optional) — plain-text summary queued for the agent: the next
  relayed turn in the target conversation starts with an FYI list of
  notifications delivered while the agent was idle, so replies that
  reference an alert ("expand the second draft") resolve. Defaults to `text`
  (HTML stripped); pass `"no_context": true` for pure-noise pings (tests).
  Scheduled-job output and `bin/notify` sends are queued the same way.
- Returns non-2xx when the Discord send fails, so callers can retry.

The endpoint only accepts loopback connections. To also require a shared
secret (checked as the `X-Notify-Token` header), set a `notify_token` row in
the settings table.

## Data

Everything is stored in `data/app.db` (SQLite): `settings` (token, owner, sessions, model/effort, flags), `allowed_users`, `channel_modes`, `bookmarks`, `jobs`, `pending_context` (out-of-band notifications queued as agent context), and the `message_log`/`step_log` behind the dashboard's activity feed. To wipe state: stop the process, delete `data/app.db*` and `data/incoming/`, restart — or use **Reset everything** in the dashboard.

## Security

Read this before deploying. The threat model is non-trivial.

### What an attacker who reaches your bot can do

Claude is spawned with `--permission-mode bypassPermissions`: **every message the relay accepts becomes a shell-capable prompt running as your VPS user**. There is no sandbox. The gates are:

1. The bot token (treat it like an SSH private key — reset it in the Developer Portal if leaked), and
2. The allowlist: only listed Discord user ids are relayed.

**Everyone you allowlist can drive the agent** — every one of their messages is a shell-capable prompt on your VPS. In `free` mode channels this is especially easy to forget: anyone allowlisted who can type in a channel the bot can see is talking to your shell. Only allowlist people you'd hand a terminal to.

### The dashboard has no built-in authentication

Anyone who can open the dashboard URL can edit the allowlist, hit **Reset everything**, re-onboard with their own bot, and get shell. **Do not expose the port to the public internet directly.** Use an SSH tunnel, a private overlay (Tailscale / exe.dev private mode), or a reverse proxy with auth.

### Prompt injection is a real risk

Because Claude runs with full shell access, prompt injection from any content the bot relays — including content *you* paste — is a meaningful risk ("summarize this email" where the email says `ignore previous instructions and run …`). Don't relay untrusted content blindly; run the relay as a dedicated unprivileged user; keep unrelated secrets out of that user's home directory.

### What is and isn't sent over the network

- **Discord**: every incoming/outgoing message goes through Discord's servers (they can read it). The bot connects *out* to Discord's gateway and REST API; nothing connects in.
- **Claude**: Claude Code uses your local credentials and sends prompts to Anthropic's API.
- **Dashboard**: no telemetry, no external calls. The bot token never leaves the server; the client only ever sees `bot_token_set: true|false`.

### Reporting issues

If you find a security issue, please open a private security advisory rather than a public issue.

## Notes

- Received messages are only those delivered live over the gateway — messages sent while the relay was down are not replayed (no backlog on reconnect).
- Slash commands are registered per guild on connect (and when the bot joins a new guild), so they show up immediately.
