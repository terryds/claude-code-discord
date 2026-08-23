# Questions to settle before/while building

Answer inline (edit this file) or just tell me. Each has a recommended
default — if you say "go with defaults", I'll build exactly these.

## 1. Who is the bot allowed to listen to?

The Telegram relay is strictly single-user. On Discord, a `free` channel in a
shared server means the bot would react to **everyone's** messages there.

- **(a) Owner-only everywhere** — only your messages ever trigger the bot;
  other members can see replies but not talk to it. **(recommended default)**
- (b) Owner-only in DMs, anyone in guild channels the bot is configured for.
- (c) Allowlist of user ids managed in the dashboard (Hermes-style
  `DISCORD_ALLOWED_USERS`).

Related: is this bot going into a server with other people at all, or a
private server that's basically just you? If it's just you, (a) and (b) are
equivalent and this question mostly disappears.

Answer: There might be other people. So i think lets make an allowlist that can be configured in the dashboard setting. So the first user in the allowlist would be the one who set it up finishing the onboarding process.

## 2. What should the *global default* mode actually cover?

You said default = free responses. Applied literally, the bot answers every
message in **every channel it can see** in every server it's invited to.
Options for channels with no explicit setting:

- **(a) Default `free`, as you specified** — works great for a personal
  server; noisy/rude in a shared one. **(recommended if the server is yours)**
- (b) Default `mention` (Hermes' default), and you flip specific channels to
  `free` in the dashboard.
- (c) Default `ignore` — bot only works in channels you explicitly enable.

Answer: A, just like what I wanted

## 3. Commands: plain text or Discord slash commands?

`/stop`, `/new_session`, `/persona`, `/skills`, `/jobs`, `/update`, `/help`
(and maybe `/model`).

- **(a) Text commands only (M7)** — simplest port, works in threads/DMs
  identically. But Discord will not autocomplete them, and in a `mention`
  channel you'd have to @bot `/stop`. **(recommended for v1)**
- (b) Real registered slash commands — native autocomplete UX, work without
  mention; more plumbing (interaction handling, responses within 3 s /
  deferrals). Could be a later milestone.

  Answer: Do both just like Hermes Agent

## 4. Step/progress streaming style

Telegram sends each thinking/tool step as its own message. Plan proposes
**one status message edited in place** per run, then the final reply as a new
message. Alternatives: keep per-step messages (noisy in channels), or no
progress at all (just typing indicator). OK with the edited-status approach?
Should it be deleted once the final reply lands, or left as a run log?
**(recommended: edited status message, deleted on completion in channels,
kept in threads)**

Answer: Keep per-step message, noisy is okay. Dont delete it.

## 5. Default delivery target for `bin/notify` and jobs

When the agent proactively messages you or a job fires without a `--channel`:

- **(a) Your DM with the bot** **(recommended)**
- (b) A configurable "home channel" setting (Hermes' `DISCORD_HOME_CHANNEL`),
  falling back to DM.

Answer: If it's related to cron (notify), just ask first if the user doesnt specify what channels to deliver the alert. If its not related to cron (tbh i dont know what case), use DM.

## 6. Model picker contents

Plan: alias buttons `fable` / `opus` / `sonnet` / `haiku` + a free-text field
for full model ids, blank = CLI default. Anything else you want (e.g. an
effort-level setting via `--effort`, or per-channel model overrides)?
**(recommended: global model only, no per-channel overrides in v1)**

Answer: yes, make effort configurable too. global model only.

## 7. The `/t` trigger token

- Exact spelling: trailing `/t` (space before it), case-insensitive? Also
  accept `/thread`? **(recommended: trailing ` /t` or ` /thread`,
  case-insensitive, stripped from the prompt)**
- Should the `/t` thread's session *start fresh* (plan's assumption, matches
  "context contained in thread") or inherit the channel session as a fork?
  Note: fresh means the bot won't remember what was just said above in the
  channel unless you repeat it.

  Answer: yes agree with your recommendation. start fresh if its a new thread. this means this also applies to the mention_mode i said (where it behaves like hermes' default: create thread & reply in the thread). /t is only for the default free_responses mode

## 8. Repo & deployment naming

- New GitHub repo `claude-code-discord` (fresh history via `git init`)? Or do
  you want the Telegram git history preserved (`git clone` + rewrite)?
  **(recommended: fresh init)**
- pm2 process name `claude-code-discord-assistant`, dir
  `~/claude-code-discord` on the VPS — match the Telegram conventions?
- Will this run on the same host/VPS alongside the Telegram relay (port
  collision: both default to 8000/3000 — I'd give Discord a distinct default,
  e.g. `PORT=8100`)?

  Answer: yes new git repo with repo name & process name "claude-code-discord-coworker", dont push to github right now. i'll go with your recommendation for the port.

## 9. Multi-guild

Support the bot being in **multiple servers** from day one (channel list
grouped by guild, per-channel modes global across guilds), or assume exactly
one guild for v1? **(recommended: the data model supports many, the UI
doesn't optimize for it)**

Answer: assume one guild right now.