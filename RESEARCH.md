# Research notes

Everything the plan is grounded in: the Telegram codebase map, Hermes Agent's
Discord behavior, Discord API facts, and `claude` CLI flags. Items marked
**[verify]** should be re-checked against live docs during the build.

## 1. Source codebase (`claude-code-telegram`) — port map

Single Bun process: `server/index.ts` serves `/api/*` (flat if-chain router) +
static `dist/client`, starts the listener and job scheduler. DB is
`data/app.db` (`bun:sqlite`, WAL): tables `settings` (key/value — also stores
session ids), `message_log`, `step_log`, `group_links`, `bookmarks`, `jobs`.

**Carries over nearly untouched:** `server/db.ts`, `server/jobs.ts` (except
its two `sendTelegramRich` calls), `server/bookmark-meta.ts`,
`server/skills.ts` (Claude half), `server/updater.ts`,
`server/dashboard-url.ts`, `server/persona.ts` (one word), `server/claude-runner.ts`,
`server/claude-stream.ts`, `server/claude-login.ts` + `pty-bridge.py`,
`bin/bookmark`, `bin/job`, `bin/doctor`, `bin/install`,
`client/src/components/AgentAuth.tsx`, and the Bookmarks / Jobs / Persona /
Updates / Activity dashboard cards.

**Rewrite:** `server/telegram.ts` → `server/discord.ts`;
`server/tg-listener.ts` → `server/discord-listener.ts` (keep its skeleton:
command handling → attachment download → prompt build → `startEngineRun`
with per-conversation `activeRuns` + abort/replace → `deliverResult` saving
the returned `session_id`); `bin/notify`; Onboarding steps 2–3;
`GroupTopicCard` → Channels card; ~15 API routes; `AGENTS.md`; `README.md`.

**Delete:** `worker/` (Cloudflare QR pairing), `server/qr-onboarding.ts` + 3
QR routes + `qrcode` dep; `server/codex-runner.ts`, `server/codex-login.ts`.

**Codex touch points to strip** (beyond the two deleted files):
`server/engines.ts` (registry), `server/engine.ts` (`EngineId` union,
labels, `API_KEY_ENV.codex`), `server/index.ts` (`/auth/codex-login/*`
routes, engine-validation error strings), `server/skills.ts`
(`scanCodexPrompts`), `server/tg-listener.ts` (`/engine` command),
`client/src/api.ts` (`codexLogin*`), `client/src/components/AgentAuth.tsx`
(codex sign-in block), `client/src/pages/Onboarding.tsx` (engine picker,
install docs), `bin/_deps.sh` (`AGENT_CLIS`), plus docs.

Mechanics worth preserving exactly:

- **Session storage**: resume ids live as `settings` rows
  (`claude_session_id`, `claude_session_id:group:<chat>:<topic>`); saved from
  `EngineResult.session_id` after each run; cleared wholesale on persona
  change / reset. Discord keys become `:dm:` / `:channel:` / `:thread:`.
- **Stale-session recovery**: `claude` output "No conversation found with
  session ID" → delete stored id, tell the user "session expired", rerun
  fresh with persona.
- **Persona** is injected only on session-*fresh* runs.
- **Run lifecycle**: `activeRuns: Map<sessionKey, {abort}>`; a new message in
  the same conversation aborts and replaces the running turn; typing
  indicator on an interval; steps streamed via `onStep` → `logStep` + send.
- **Claude runner**: `claude -p <prompt> --permission-mode bypassPermissions
  --output-format json [--resume <id>]`, env merged with auth overrides;
  live step streaming by tailing
  `~/.claude/projects/<cwd-dashed>/<sessionId>.jsonl` (first turn of a new
  session has no id → no live steps; known limitation).
- **Jobs contract** (`docs/scheduled-jobs.md`): stdout-is-the-message,
  exit 0 + non-empty → deliver; `$STATE_FILE`/`$JOB_NAME`/`$JOB_DIR`; UTC
  cron; 10-min timeout; escalation ladder script → script+`claude -p` on
  trigger → scheduled agent turn (warn: billed). Delivery today is hardcoded
  to the private chat — the Discord port parameterizes it.
- **`bin/notify` pattern**: reads token + target straight from `data/app.db`
  via `sqlite3` so it works while the relay is down. Keep this property.

## 2. Hermes Agent Discord behavior (reference implementation)

From https://hermes-agent.nousresearch.com/docs/user-guide/messaging/discord
and the `nousresearch/hermes-agent` repo (`plugins/platforms/discord/adapter.py`,
`tools/discord_tool.py`).

Response logic:

- DMs: always respond, no mention needed.
- Server channels: mention required by default (`DISCORD_REQUIRE_MENTION=true`);
  `free_response_channels` list exempts channels **and skips auto-threading**
  ("so the channel stays a lightweight chat").
- Auto-threading (`DISCORD_AUTO_THREAD=true`): every @mention in a text
  channel spawns a thread from the triggering message; bot then replies
  in-thread without re-mention. `no_thread_channels` opts out per channel.
- Threads: bot replies in-thread; a thread has an isolated session, separate
  from the parent channel.
- `ignored_channels` (never respond) > `allowed_channels` whitelist.
- `DISCORD_IGNORE_NO_MENTION=true`: if a message mentions other users but not
  the bot, stay silent.
- Thread naming: strip `<@id>`/`<@&id>`/`<#id>` mention syntax, collapse
  whitespace, first 80 chars (77 + "..." if longer); real semantic rename via
  LLM after the first turn (we defer that part).
- Anti-spam defaults: `@everyone`/`@here` and role pings blocked; individual
  user pings allowed.
- Setup guide steps (basis for our onboarding copy): New Application → Bot →
  **Privileged Gateway Intents: Message Content + Server Members ON** (the
  #1 silent-failure cause) → Reset Token (shown once) → invite URL with
  scopes `bot+applications.commands` → authorize into server. Recommended
  permissions integer `274878286912` (View Channels, Send Messages, Send
  Messages in Threads, Embed Links, Attach Files, Read Message History, Add
  Reactions) — we additionally need **Create Public Threads** (and possibly
  Manage Threads for renaming) **[verify final integer at build time]**.

`discord_tool.py` action set (template for `bin/discord`): list_guilds,
server_info, list_channels, channel_info, list_roles, member_info,
search_members (`GET /guilds/{id}/members/search?query=`), fetch_messages,
list_pins, pin/unpin, delete_message, create_thread, add/remove_role. Plain
REST wrapper over the bot token — no gateway connection needed for the tool.

## 3. Discord API facts the plan relies on

- **Gateway required** for receiving messages (bots can't poll). Intents:
  `GUILDS`, `GUILD_MESSAGES`, `DIRECT_MESSAGES`, plus privileged
  `MESSAGE_CONTENT` (portal toggle). `GUILD_MEMBERS` privileged intent is for
  gateway member events; the REST member-search endpoint works without it
  **[verify]**. discord.js v14 wraps gateway + REST and runs on Bun
  (official Bun guide: https://bun.com/docs/guides/ecosystem/discordjs).
- **Message limit 2000 chars** for bots (embed descriptions 4096 — not used
  for replies in this plan). Chunk on paragraph boundaries; re-open code
  fences across chunks.
- **Markdown subset**: bold/italic/underline/strikethrough, inline code,
  fenced code blocks with language highlighting, block quotes, headers
  `#`–`###`, lists, spoilers, `-# subtext`, masked `[text](url)` links (work
  for bots). **No tables, no horizontal rules** — AGENTS.md must tell the
  agent to avoid them. Bare URLs unfurl into preview embeds; `<url>` or
  `SUPPRESS_EMBEDS` flag suppresses.
- **Threads are channels**: replying "in the thread" = sending to the thread's
  own channel id (no `message_thread_id` equivalent). Create from a message:
  `POST /channels/{cid}/messages/{mid}/threads` (name ≤ 100 chars,
  `auto_archive_duration` 60/1440/4320/10080). Telegram's `SendTarget
  {chatId, threadId}` collapses to one `channelId`.
- **DMs**: a bot can only DM users who share a guild with it; open a DM
  channel via `POST /users/@me/channels {recipient_id}` then send to that
  channel id. Cache `discord_dm_channel_id`.
- **Application id** is recoverable from the bot token (first `.`-separated
  segment, base64-decoded) → lets onboarding auto-generate the invite URL
  from just the pasted token **[verify]**.
- **Typing indicator**: `POST /channels/{id}/typing`, lasts ~10 s → refresh
  every ~8 s during a run (Telegram used 4 s).
- **Attachments**: direct CDN URLs on the message object (no `getFile` hop);
  standard upload limit 25 MB **[verify current value]**.
- **allowed_mentions**: set `parse: ["users"]` (and `replied_user` as
  desired) on every send so agent output can ping people but never
  `@everyone`/roles.
- No bot-token API for a per-guild "profile description" → the Telegram
  `applyBotDescription` (dashboard link in bot bio) feature is dropped;
  `PATCH /applications/@me` description exists but is app-global
  **[verify whether worth using]**.
- Rate limits: per-route buckets; discord.js queues automatically. The step
  status message uses **edits** to one message, which also keeps us clear of
  send rate limits.

## 4. `claude` CLI facts (verified against the installed binary)

- `claude -p <prompt> --output-format json` — single JSON result (current
  runner parses it; keep).
- `--resume <session-id>` resumes; `--session-id <uuid>` pins a specific id;
  `--model <alias-or-full-name>` (aliases: `fable`, `opus`, `sonnet`, …);
  `--permission-mode bypassPermissions` (current usage);
  `--append-system-prompt` exists if we later prefer metadata out-of-band of
  the user prompt; `--allowedTools/--disallowedTools`, `--mcp-config`
  available if we ever go the MCP route for Discord tools (not planned —
  `bin/discord` via Bash is simpler and matches the existing pattern).
- Stale sessions surface as "No conversation found with session ID" in
  output — existing detection logic ports as-is.
