# claude-code-discord — Implementation Plan

Port of `claude-code-telegram` to Discord: a single-user, self-hosted relay that
forwards Discord messages to **Claude Code** (`claude -p`) running on this host
and sends the reply back. Codex support is dropped.

Companion docs:

- [RESEARCH.md](RESEARCH.md) — everything learned from the Telegram codebase,
  Hermes Agent's Discord implementation, the Discord API, and the `claude` CLI.
- [QUESTIONS.md](QUESTIONS.md) — decisions I need from you before/while building.

---

## Headline decisions (proposed)

| Area | Decision |
|---|---|
| Starting point | `cp -R` the telegram repo, then strip/rewrite (M0). Same stack: Bun + React (Vite) + Tailwind + `bun:sqlite`, single process serving `/api/*` + dashboard. |
| Discord connectivity | **discord.js v14** over the Gateway (WebSocket). Replaces Telegram long-polling; discord.js handles heartbeat/reconnect/resume. Officially supported on Bun. |
| Engine | Claude only. Delete Codex files; collapse the engine abstraction into a thin `server/claude.ts` config module (auth method, API key, model) — keep the `EngineResult`/`EngineStep` shapes since the runner + activity feed depend on them. |
| Response modes | Per-channel setting with a global default. `free` (default): reply inline, no mention needed; message ending in **`/t`** → create a thread and reply there. `mention`: only respond when @mentioned → auto-create a thread from the message → reply in-thread (Hermes' default behavior). Inside a bot-created thread the bot always replies, no mention needed. DMs are always free/inline. |
| Sessions | One Claude session per conversation context: per DM channel, per guild channel (inline replies), per thread. **Every newly created thread starts a fresh `claude -p` session** (no `--resume`), so context is contained in the thread. Same storage pattern as today (`settings` rows, `claude_session_id:<context>`). |
| Authorization | **Allowlist of Discord user ids, managed in the dashboard.** The user who completes onboarding (first captured message) becomes the first allowlist entry ("the owner"). Messages from anyone else are ignored. |
| Output format | Plain Discord Markdown messages (no embeds for replies). Chunk at 2000 chars on paragraph boundaries. No tables/HR in Discord — AGENTS.md teaches the agent to avoid them. `allowed_mentions` permits individual `@user` pings, blocks `@everyone`/`@here`/roles. |
| Model & effort | Dashboard settings `claude_model` → `--model <value>` and `claude_effort` → `--effort <low|medium|high|xhigh|max>`. Model choices: fable / opus / sonnet / haiku aliases + free-text for full model IDs; blank = CLI default. Global only (no per-channel overrides). Changing them does **not** reset sessions. |
| Commands | **Both, like Hermes**: text-parsed commands (`/stop`, `/new_session`, …) work in any message the bot processes, **and** the same commands are registered as native Discord slash commands (autocomplete, typed choices for `/model` + `/effort`, ephemeral replies, allowlist-checked in the interaction handler). |
| Step streaming | **Per-step messages, Telegram-style** (🧠 thinking / 🛠 tool / ✅ result), throttled, never deleted. Noise in channels is accepted. |
| Scale assumptions | One guild for v1 (data model doesn't preclude more; UI doesn't optimize for it). |
| Naming & deploy | Repo + pm2 process name **`claude-code-discord-coworker`**; fresh `git init`, **no GitHub push for now**; default `PORT=8100` (avoids collision with the Telegram relay on the same host). |
| Metadata | Every prompt is prefixed with a structured Discord context block (user id, username, display name, channel id/name, guild name, thread id/name when present). |
| Agent's Discord powers | New `bin/discord` CLI (modeled on Hermes' `discord_tool`): REST wrapper the agent calls via Bash — search members, list channels, fetch messages, send messages, react, create threads. `bin/notify` rewritten on the same core. No MCP server needed. |
| Cron/jobs | Keep the existing jobs system (script-first cost ladder). Add a **delivery channel** per job — `--channel` is **required** on `bin/job add`; AGENTS.md rule: if the user didn't say where to deliver, the agent must **ask before registering** (never silently default). Non-job proactive messages (`bin/notify` without `--channel`) go to the owner's DM. |

---

## Milestones

Each milestone ends in a working, typechecking state (`bun run typecheck && bun run build`).

### M0 — Bootstrap: copy, rename, strip

Goal: the copied app boots (still Telegram-flavored inside) with Codex and
Telegram-only dead weight removed.

1. Copy the telegram repo contents into this directory (excluding `.git/`,
   `data/`, `dist/`, `node_modules/`); fresh `git init` + initial commit
   (local only — no GitHub remote for now).
2. Rename: `package.json` name → `claude-code-discord-coworker`, pm2 process
   default in `bin/safe-update-relay` → `claude-code-discord-coworker`,
   `client/index.html` title, boot log. Default port → **8100** in
   `server/index.ts` + `vite.config.ts` proxy + `bin/job`/`bin/bookmark`
   port probes.
3. Delete Telegram-only surfaces with no Discord analogue:
   - `worker/` (Cloudflare QR-pairing worker), `server/qr-onboarding.ts`,
     the 3 QR API routes in `server/index.ts`, QR branch of Onboarding step 2,
     `api.qrStart/qrPoll/qrCancel`, the `qrcode` dependency.
4. Remove Codex (full list of touch points in [RESEARCH.md](RESEARCH.md) §4):
   - Delete `server/codex-runner.ts`, `server/codex-login.ts`.
   - Collapse `engine.ts`/`engines.ts` → `server/claude.ts` (auth config,
     `EngineResult`/`EngineStep` types, `authEnv`, auth probe cache).
   - Strip Codex from `index.ts` routes, `skills.ts`, `api.ts`,
     `AgentAuth.tsx`, `Onboarding.tsx` engine picker, `bin/_deps.sh`
     (`AGENT_CLIS=(claude)`), `/engine` command.
5. Typecheck + build green. (App still talks Telegram — that dies in M1.)

**Acceptance:** `bun run dev` serves the dashboard; no `codex`/`qr` references
outside docs.

### M1 — Discord core relay (DM happy path)

Goal: DM the bot → `claude -p` runs → reply arrives in the DM.

1. `bun add discord.js`.
2. New `server/discord.ts` (replaces `server/telegram.ts`):
   - Client with intents `Guilds`, `GuildMessages`, `DirectMessages`,
     `MessageContent`; partials for DM channels.
   - `sendDiscord(channelId, markdown)` — chunk at 2000 chars using the
     existing `splitMarkdown` (ported, `MAX = 2000`), set `allowed_mentions`,
     `flags: SuppressEmbeds` for status/step messages only.
   - Typing indicator helper (`sendTyping` every ~8 s while a run is active;
     Discord typing lasts 10 s).
   - `getBotInfo` (`/users/@me`), token validation, invite-URL builder (the
     application id is base64-decoded from the token's first segment —
     verify at build time; fall back to asking for the app id).
3. New `server/discord-listener.ts` (port of `tg-listener.ts`, same skeleton:
   commands → attachments → prompt build → `startEngineRun` → `deliverResult`):
   - `SendTarget` collapses to a single `channelId` (a thread **is** a channel).
   - Owner capture: while capture mode is on, the first message records the
     sender as `discord_owner_id` (+ `discord_dm_channel_id`) — and as the
     **first entry of the allowlist**.
   - Auth check: `msg.author.id` ∈ allowlist (new `allowed_users` table:
     `user_id` PK, `username`, `added_at`); ignore bots/self.
   - Keep: session storage pattern, `activeRuns` map, stop-and-replace,
     stale-session recovery, persona-on-fresh-session, step logging.
   - Step streaming: **per-step messages, Telegram-style** — port
     `formatStep` to Discord Markdown (🧠 thinking / 🛠 tool + code-fenced
     input / ✅ result), keep the 500 ms throttle, truncate to fit 2000
     chars, `SUPPRESS_EMBEDS`. Steps are never deleted; final reply is a
     separate message.
4. Settings keys: `discord_bot_token`, `discord_owner_id`,
   `discord_dm_channel_id`, `relay_enabled` (kept); `allowed_users` table
   above. Delete `telegram_update_offset`/backlog logic (Gateway delivers
   no backlog).
5. Rewire `server/index.ts` status/onboarding routes to Discord equivalents.
6. Delete `server/telegram.ts`, `server/tg-listener.ts`.

**Acceptance:** with a token pasted via API, DMing the bot returns a Claude
reply; `/stop`, session resume across messages, and the activity feed work.

### M2 — Onboarding + dashboard rebrand

Goal: a new user can go from zero to linked bot entirely via the dashboard.

1. Rewrite `Onboarding.tsx`:
   - **Step 1** — Claude auth (reuse `AgentAuth`, single engine, no picker).
   - **Step 2 — Create your Discord bot** (clear numbered instructions):
     1. Open https://discord.com/developers/applications → **New Application**, name it.
     2. **Bot** tab → toggle ON **Message Content Intent** (and Server Members
        Intent) under *Privileged Gateway Intents*. Call out that skipping
        this is the #1 cause of a silently-deaf bot.
     3. **Reset Token** → copy it (shown once) → paste below.
     4. After the token validates, show a generated **invite link**
        (client id auto-derived from the token; scopes `bot` +
        `applications.commands`; computed permissions) — "open it, pick
        your server, Authorize".
   - **Step 3 — Say hi** — "DM your bot (or write in a channel it can see)";
     capture owner id → seeds the allowlist, show captured username; poll
     like today.
   - **Step 4** — done; relay enabled; welcome DM sent (port of
     `sendOnboardingDone`, code-block prompt suggestion instead of the
     Telegram copy-button).
2. Dashboard header: "Connected as @{bot} · owner @{user}", Discord blurple
   `#5865F2` CTA linking to the bot's DM (`https://discord.com/users/<botId>`
   caveats apply — verify best deep link at build time).
3. Remove `applyBotDescription` (no Discord equivalent from a bot token);
   dashboard URL lives in the welcome DM + `/help` instead.
4. `/api/status` returns Discord shape: bot user, owner, guilds the bot is in.
5. **Allowed users card**: list allowlist entries (username + id, "owner"
   badge on the first), add by user id, remove (owner not removable);
   `GET|POST|DELETE /api/allowed-users`.

**Acceptance:** fresh DB → full onboarding via browser only, ending with a
working DM conversation.

### M3 — Channel modes, threads, sessions-per-thread

Goal: requirement #6/#7 — free vs mention mode, `/t`, auto-threads, contained sessions.

1. New table `channel_modes` (`channel_id` PK, `mode` `'free'|'mention'|'ignore'`,
   `channel_name`, `guild_name`, `updated_at`) + settings key
   `default_channel_mode` (default `free`).
2. Listener logic (mirrors Hermes, documented in RESEARCH §2):
   - DM → always respond inline.
   - Thread the bot created (or has participated in) → always respond, session
     keyed to the thread id.
   - Guild channel, effective mode `free` → respond inline, session keyed to
     the channel. If the message ends with `/t` (trailing token, stripped from
     the prompt) → create a thread from that message, **fresh session**, reply
     in-thread.
   - Effective mode `mention` → only respond when the bot is @mentioned
     (mention stripped from prompt) → create a thread from the message
     (name = first ~80 chars, mention syntax stripped — Hermes' recipe),
     **fresh session**, reply in-thread.
   - Effective mode `ignore` → never respond.
3. Dashboard "Channels" card (replaces `GroupTopicCard`): global default mode
   picker + list of text channels from the bot's guilds (`/api/channels`,
   fetched via REST) with a per-channel mode override; shows active thread
   sessions with a per-thread "reset session" affordance (nice-to-have).
4. Session keys: `claude_session_id:dm:<channelId>`,
   `:channel:<channelId>`, `:thread:<threadId>`; update `clearAllSessions`.

**Acceptance:** in a `free` channel the bot answers without mention; `... /t`
spawns a thread with fresh context; in a `mention` channel only @bot triggers,
in a thread; follow-ups in a thread resume that thread's session only.

### M4 — Model/effort settings + metadata injection

1. `claude_model` and `claude_effort` settings; `claude-runner.ts` appends
   `--model <value>` / `--effort <value>` when set. Dashboard "Model" card:
   alias buttons (fable / opus / sonnet / haiku) + free-text input for full
   model IDs, effort picker (default / low / medium / high / xhigh / max);
   blank = CLI default.
2. Metadata block prepended to every prompt (replaces the group-title prefix):

   ```
   (Discord context: from @{username} ({display_name}, id {user_id})
    in #{channel_name} (id {channel_id}) of "{guild_name}"
    — thread "{thread_name}" (id {thread_id}) —
    your reply is delivered back there.)
   ```

   DMs get a minimal `(Discord DM from @{username}, id …)` variant.
3. Persona default copy reworded for Discord.

**Acceptance:** asking the bot "what channel is this and who am I?" answers
correctly; `claude_model` visibly changes the model (check via a "which model
are you" probe or run log).

### M5 — Discord tools for the agent + AGENTS.md rewrite

Goal: requirement #10 — "mention Andi and tell him to check the dishwasher".

1. New `bin/discord` (bash + curl + jq, same style as `bin/notify`; reads
   `discord_bot_token` from `data/app.db` so it works with the relay down).
   Subcommands (modeled on Hermes' tool actions):
   - `send <channel_id> [--md] <text|stdin>` (chunked)
   - `search-member <guild_id> <query>` → id, username, display name
   - `list-guilds`, `list-channels <guild_id>`, `channel-info <id>`
   - `fetch-messages <channel_id> [--limit N]`
   - `create-thread <channel_id> <message_id> <name>`
   - `react <channel_id> <message_id> <emoji>`
2. Rewrite `bin/notify` on the same core: default target = owner DM channel
   (opens one via `POST /users/@me/channels` if missing); `--channel <id>`
   to target any channel/thread; `--md` retained (chunking only — Discord
   markdown needs no parse-mode); `--dry-run`.
3. Rewrite `AGENTS.md` for Discord:
   - Replying: Discord Markdown subset (no tables, no `---`, headers/lists/
     code fences OK), 2000-char chunking is handled by the relay, bare URLs
     auto-preview (use `<url>` to suppress).
   - Mentions: `<@user_id>` (find ids via `bin/discord search-member`);
     never `@everyone`/`@here` (relay blocks them anyway).
   - Keep: localhost-URL rules, bookmarks, proactive messaging (`bin/notify`),
     detached-job patterns, safe-update-relay — with Discord wording.
4. Update `sendOnboardingDone` welcome + `/help` to mention these abilities.

**Acceptance:** "please mention Andi and tell him to check out the dishwasher"
results in a message containing a real `<@id>` ping for the matching member.

### M6 — Jobs: channel delivery + notify plumbing

Goal: requirement #12 — "check BTC/USD at 5pm daily, alert in #btcusdalert".

1. `jobs` table gains `channel_id TEXT NOT NULL`. **`--channel <id>` is
   required on `bin/job add`** (a DM channel id is valid — "deliver to my DM"
   is an explicit choice, never a silent fallback); dashboard jobs card shows
   the delivery target.
2. `server/jobs.ts` delivers stdout via `sendDiscord(job.channel_id, …)`;
   3-consecutive-failures warning goes to the owner DM.
3. `docs/scheduled-jobs.md` updates: delivery-channel contract ("the user must
   name the destination channel; if they didn't, **ask** before registering —
   never assume"), agent resolves `#name` → id via `bin/discord`,
   script-first cost ladder and UTC-schedule rules kept verbatim.
   Non-job proactive messages (`bin/notify` without `--channel`) default to
   the owner DM.
4. `bin/safe-update-relay`'s inline notify → Discord REST (owner DM).

**Acceptance:** the exact BTC prompt from the requirements yields: a
deterministic price-check script registered with `bin/job add --channel
<#btcusdalert id>`, firing 17:00 user-local (converted to UTC), messaging only
when BTC > 70k, and the agent's reply closes the loop (name, schedule,
trigger, how to remove).

### M7 — Attachments + polish

1. Attachments: Discord gives direct CDN URLs — download to `data/incoming/`
   (25 MB cap), append local path to the prompt; port the four prompt builders
   (image/video/audio/document) minus the Telegram `getFile` hop.
2. Commands — **both layers, like Hermes**:
   - Text-parsed: `/stop`, `/new_session`, `/persona`, `/skills`, `/jobs`,
     `/update`, `/help`, `/model`, `/effort` handled from message content in
     any conversation the bot processes (port of the Telegram command block).
   - Native slash commands: same set registered via
     `PUT /applications/{id}/commands` on boot (guild-scoped for instant
     availability), handled in `interactionCreate` with the allowlist check,
     ephemeral replies for list-y output (`/jobs`, `/skills`, `/help`),
     typed choices for `/model` (aliases + free-text option) and `/effort`,
     deferred ack only for `/update`.
3. Edge cases: message > 2000 splitting inside code fences (re-open fence in
   next chunk), empty-message drops, bot-authored/other-bot messages ignored,
   `mention`-mode message that mentions *someone else* only → stay silent
   (Hermes' `ignore_no_mention`).

### M8 — Docs + QA

1. Rewrite `README.md` (setup, Developer Portal walkthrough incl. intents,
   pm2/VPS notes, security section: dashboard has no auth + bot token grants
   the agent full REST power).
2. Update `exe-dev-setup-prompt.md`, prune `docs/`.
3. QA checklist run-through (each milestone's acceptance + onboarding from a
   clean `data/`), `bin/doctor` pass.

---

## Cut / deferred (not in this plan)

- QR onboarding + Cloudflare worker (Telegram-only concept) — deleted.
- Bot profile description with dashboard link — no bot-token API for it.
- Voice channels, reactions-as-UI, message components/buttons.
- Per-user sessions within a shared channel (Hermes' `group_sessions_per_user`)
  — allowlisted users in the same channel/thread **share** that context's
  session in v1.
- Multi-guild UI (data model allows it; one guild assumed).
- LLM-based thread renaming after the first turn (Hermes does this; we use
  first-message-derived names).
