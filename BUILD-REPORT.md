# Build report — claude-code-discord-coworker

Full build of the Discord port, M0 → M8 per [PLAN.md](PLAN.md). Everything
typechecks (`bun run typecheck`), builds (`bun run build`), and boots
(`bun run dev` / `bun start`, port **8100**). What could be tested without a
live Discord bot has been; the rest is listed in [FOLLOWUP.md](FOLLOWUP.md).

## Commits (local only — nothing pushed, per your instruction)

| commit | contents |
|---|---|
| `c657d73` | Verbatim import of the claude-code-telegram source as the starting point |
| `5453458` | **M0–M4** — Codex + QR/worker stripped, Discord core relay, modes/threads/sessions, commands, model/effort, dashboard + onboarding rebuild |
| `bca74a7` | **M5–M6** — `bin/discord`, `bin/notify` rewrite, jobs channel delivery, AGENTS.md + scheduled-jobs contract |
| `aa26628` | **M8** — README + exe.dev prompt rewrite, comment sweep |
| `aabd721` | Post-review fixes (chunking fence margin, partial-DM guard) + smoke tests |

## What was built, by milestone

### M0 — Bootstrap
- Repo copied (excluding `.git`, `data`, `dist`, `node_modules`), fresh `git init`.
- Renamed everywhere to **`claude-code-discord-coworker`** (package.json, pm2
  default in `bin/safe-update-relay`, page title, boot log).
- Default port **8100** (fallback 8101) in the server, Vite proxy, and the
  port probes of `bin/job` / `bin/bookmark`.
- **Deleted**: `worker/` (Telegram QR pairing service), `server/qr-onboarding.ts`
  + its routes + the `qrcode` dependency, `server/codex-runner.ts`,
  `server/codex-login.ts`, `server/telegram.ts`, `server/tg-listener.ts`,
  `server/engines.ts`.
- Engine abstraction collapsed: `server/engine.ts` is now Claude-only types +
  persisted auth config (parameterless helpers; settings keys keep their
  `_claude` suffix); `claude-runner.ts` is imported directly.

### M1 — Discord core relay
- **`server/discord.ts`** — REST layer: `discordApi` (429-retry), token
  validation (`/users/@me`), application-id resolution (`/applications/@me`,
  cached), invite-URL builder (scopes `bot+applications.commands`, permissions
  incl. threads), **2000-char fence-aware `splitMarkdown`**, `sendDiscord`
  (chunked, `allowed_mentions: users`-only so `@everyone`/roles never fire),
  typing, thread creation, DM-channel opening, attachment download (25 MB cap),
  guild/channel listing.
- **`server/discord-listener.ts`** — the heart (~900 lines): a discord.js
  gateway client (intents: Guilds, GuildMessages, DirectMessages,
  MessageContent) with a settings-token watchdog (reconnects when the token
  changes; no offset/backlog bookkeeping — the gateway has none).
  Ported intact from the Telegram listener: per-conversation `activeRuns` with
  auto-stop-&-replace, stale-session recovery, persona injection on fresh
  sessions only, throttled per-step streaming (🧠/🛠/✅ as Markdown messages,
  never deleted), step + message logging feeding the dashboard activity feed,
  auth-error → dashboard re-auth instructions, AskUserQuestion rendering.

### M2 — Onboarding + dashboard rebrand
- `Onboarding.tsx` rewritten: (1) Claude auth (reused `AgentAuth`, single
  engine), (2) Developer-Portal walkthrough — New Application → **privileged
  intents warning called out as the #1 silent-failure cause** → Reset Token →
  paste → auto-generated **invite link** (client id derived from the token via
  `/applications/@me`), (3) "Say hi" capture → first sender becomes owner +
  first allowlist entry, (4) done → relay on + welcome DM with dashboard link
  and a copyable example prompt.
- Dashboard header: "Connected as @bot · owner @user", Discord-blurple
  **Open Discord** button; Telegram branding gone.
- `applyBotDescription` (Telegram bot-bio dashboard link) dropped — no Discord
  bot-token equivalent.

### M3 — Channel modes, threads, sessions
- New tables: **`allowed_users`** (owner seeded at capture, owner not
  removable) and **`channel_modes`** (per-channel override; global default via
  `default_channel_mode` setting, `free` out of the box). `group_links` gone.
- Listener mode logic (Hermes-derived):
  - DM → always respond; session `claude_session_id:dm:<channel>`.
  - Known thread (bot-created or has a session) → always respond; session
    `:thread:<id>`. Unknown threads follow the parent channel's mode.
  - Guild channel `free` → inline reply, session `:channel:<id>`; trailing
    ` /t` / ` /thread` → **create a thread from the message, fresh session**.
  - `mention` → only on explicit @bot mention → thread from the message
    (name = first ~80 chars, mention syntax stripped — Hermes' recipe),
    fresh session. Messages mentioning only other people are ignored.
  - `ignore` → silent. Commands never spawn threads; they answer in place.
- Dashboard **Channels & response modes** card: default-mode picker with
  per-mode explanations + all visible text channels (grouped info + per-channel
  override select), graceful when Discord is unreachable.
- **Allowed users** card: list with owner badge, add by user id (with the
  Developer-Mode how-to), remove.

### M4 — Model/effort + metadata
- `claude_model` / `claude_effort` settings → `--model` / `--effort` flags on
  `claude -p` (flags verified against the installed CLI). Dashboard **Model**
  card: default + fable/opus/sonnet/haiku buttons + free-text full id, effort
  picker; changes don't reset sessions.
- Every prompt gets a Discord context prefix: sender username, display name,
  user id, channel name + id, server name + guild id, thread name + id when
  present, and where the reply will land. DMs get a compact variant.

### M5 — Agent Discord tools
- **`bin/discord`** — REST CLI for the agent (token from `data/app.db`, works
  with the relay down): `guilds`, `channels`, `channel-info`, `search-member`,
  `member-info`, `roles`, `messages`, `send` (chunked, stdin ok), `dm`,
  `create-thread`, `react`. Compact JSON out.
- **`bin/notify`** rewritten: default target = owner DM (opened + cached on
  demand), `--channel <id>` for anything else, Markdown-native, `--md`
  accepted as a no-op for muscle-memory compat, `--dry-run`, 1900-char chunks.
- **`AGENTS.md`** rewritten: Discord Markdown rules (no tables/HR, 2000-char
  chunking handled by the relay, `<url>` to suppress unfurls), mention
  etiquette (`<@id>` via `search-member`; `@everyone` always neutralized),
  `bin/discord` cookbook incl. the "mention Andi" recipe, kept the
  localhost-URL and bookmark rules, proactive-messaging patterns updated.

### M6 — Jobs with channel delivery
- `jobs.channel_id` column (+ idempotent `ALTER` for copied DBs).
  **`--channel` required on `bin/job add`** (API and direct-DB paths both
  enforce it; re-register may omit it to keep the existing one).
- `server/jobs.ts` delivers stdout to the job's channel; 3-consecutive-failure
  warnings go to the owner's DM. `bin/safe-update-relay` notifies over Discord
  (owner DM, Markdown).
- `docs/scheduled-jobs.md`: new "delivery channel — required, never assumed"
  section (ask if the user didn't name one; resolve `#name` → id via
  `bin/discord`), example flipped to the BTC-above-$70k edge-triggered watcher,
  cost ladder and UTC rules kept verbatim.
- Dashboard jobs card shows each job's delivery channel.

### M7 — Commands + attachments
- **Both command layers, like Hermes**: text-parsed (`/stop`, `/new_session`,
  `/model`, `/effort`, `/persona`, `/skills`, `/jobs`, `/update`, `/help`,
  `/start`) in any conversation the bot processes, **and** the same set
  registered as native slash commands per guild on connect (instant
  availability; re-registered on `guildCreate`). Slash replies are ephemeral,
  chunked via follow-ups, allowlist-checked, with typed choices for `/effort`.
- Attachments: every attachment on a message (multiple supported) is
  downloaded from its CDN URL to `data/incoming/<id>-<name>` (sanitized),
  25 MB cap with a friendly rejection, and a per-type hint (image → Read tool,
  video → ffmpeg, audio → transcribe, other → Read/inspect) is prepended to
  the prompt.

### M8 — Docs
- `README.md` fully rewritten (features, Developer-Portal setup, channel
  modes, allowlist, VPS/pm2 on port 8100, security section updated for the
  allowlist trust model and outbound-only gateway).
- `exe-dev-setup-prompt.md` rewritten for the Discord relay (port 8100, no
  inbound port needed).
- Comment sweep: zero Telegram references left in code.

## Verified in this build

- `bun run typecheck` and `bun run build` green; server boots, serves the
  dashboard, and all new API routes (`/api/status`, `/api/channels`,
  `/api/model`, `/api/allowed-users`) respond correctly, degrading gracefully
  with no token.
- `splitMarkdown` unit-tested: no chunk exceeds 2000 chars, code fences stay
  balanced across chunks, content preserved.
- `bin/notify --dry-run`, `bin/discord help`, and the `bin/job` add/list flows
  (including the required-`--channel` rejection and the direct-DB fallback)
  tested against a scratch DB. All bin scripts pass `bash -n`.

## Known limitations (inherited or accepted)

- First turn of a brand-new session has no live step streaming (the session id
  isn't known until the run ends — same limitation as the Telegram version).
- Allowlisted users in the same channel/thread share that context's session
  (per-user sessions in shared channels deferred, per plan).
- The global `free` default applies to every channel the bot can see in every
  guild — flip the default or per-channel modes in the dashboard for shared
  servers.
- Messages sent while the relay is down are not replayed (gateway has no
  backlog; the Telegram offset-replay semantics don't exist here).
- Single-guild UI assumption (the data model handles more; the channels list
  just shows everything flat with guild names).
