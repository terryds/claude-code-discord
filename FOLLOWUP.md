# Follow-up — what you need to do / test

I built and verified everything that's testable without a live Discord bot and
a deployed host. The items below need you (roughly in order).

## 1. Do the real onboarding once (≈5 minutes) — the critical path

I could not exercise anything that needs a real bot token. Run through it:

1. `cd ~/playground/claude-code-discord && bun run dev` → open
   http://localhost:5173 (or `bun run build && bun start` → http://localhost:8100).
2. Step 1: Claude auth should show as already authenticated on this machine.
3. Step 2: create the Discord app — **don't skip the two privileged intents**
   (Message Content + Server Members) — paste the token, and check that the
   **invite link appears and works** (this validates my token→application-id
   derivation). Invite the bot into a test server.
4. Step 3: send the bot a message → you should be captured as owner and get
   the welcome DM/reply.

Then verify, in this order (each verifies a subsystem I couldn't):

- [ ] **DM roundtrip**: DM the bot → steps stream in → final reply arrives.
- [ ] **Session continuity**: a follow-up DM remembers the previous turn.
- [ ] **Free channel**: message in a server channel → inline reply, no mention.
- [ ] **`/t`**: end a message with ` /t` → thread created off your message,
      reply inside, fresh context (it shouldn't remember the channel talk).
- [ ] **Mention mode**: set a channel to "Mention → thread" in the dashboard →
      plain messages ignored; `@bot …` spawns a thread; follow-ups in the
      thread work without mentioning.
- [ ] **Slash commands**: type `/` in the server — the bot's commands should
      autocomplete (they register per-guild on connect). Try `/model`,
      `/effort`, `/stop`; replies should be ephemeral (only you see them).
- [ ] **Non-allowlisted user**: have someone else (or an alt) message — the
      bot must stay silent. Add them via the dashboard's Allowed users card
      and retry.
- [ ] **Attachment**: send an image with a caption → the agent should read it.
- [ ] **bin/discord live**: ask the bot "mention <someone> in #general and
      tell them hi" → verifies member search + send + real `<@id>` ping.
      (Member search uses a REST endpoint that should not need a privileged
      intent — if it 403s, the Server Members intent toggle covers it.)
- [ ] **Notify gateway + FYI context**: with the relay running and onboarded,
      `curl -s -X POST http://127.0.0.1:8100/api/notify -H 'Content-Type: application/json' -d '{"text":"**test alert**","source":"smoke","kind":"test"}'`
      → message lands in your DM and shows as `[smoke · test]` in the
      dashboard feed. Then send the bot any DM — its prompt should carry the
      "FYI — while you were idle" preamble (ask it "what notifications did I
      just get?"). Also try `bin/notify "hello"` (routes through the gateway
      when the relay is up).
- [ ] **Job flow**: "check the BTC price every day at 5pm and tell me in
      #test-alerts if it's above 70k" → the agent should ASK for nothing
      (channel named), write a script, register with `--channel`, and confirm
      schedule in your timezone. Then `bin/job run btc-…` (or "run it now")
      → message lands in #test-alerts. Also try a request **without** naming
      a channel — the agent must ask, not assume.

## 2. Git remote — ✅ done

Public repo at https://github.com/terryds/claude-code-discord with `origin`
set (secret-scanned across all commits first: no tokens/keys anywhere; the
only personal traces are your public git identity and links to your
already-public telegram repo). `/update`, the dashboard's Updates card, and
`bin/safe-update-relay` are now functional.

## 3. Deployment decisions

- Deploy target: same VPS as the Telegram relay? Port **8100** avoids the
  collision; pm2 name `claude-code-discord-coworker`. `exe-dev-setup-prompt.md`
  is ready to paste (repo URL filled in).
- The dashboard has **no auth** (same as the Telegram one) — keep port 8100
  behind exe.dev private mode / a tunnel. Discord itself needs no inbound port.
- `bin/doctor` on the VPS to confirm deps (it no longer checks for codex).

## 4. Small decisions you may want to revisit

- **"Open Discord" button** in the dashboard header currently opens
  `discord.com/channels/@me` (the DM list). If you'd rather it deep-link
  straight into the bot's DM, say so — trivial to add once a DM channel id
  exists.
- **`/persona` via slash command** takes the new text as a single option
  string; long personas are easier via the dashboard card.
- **Thread names** come from the message's first ~80 chars. Hermes later
  renames threads with an LLM-generated title; deferred here.
- The **`fable` model alias** and `--effort` flag were verified against the
  `claude` CLI on *this* machine — if the VPS runs an older CLI, update it.

## 5. State of the world

- Everything is on `main`, pushed to https://github.com/terryds/claude-code-discord —
  review with `git log -p`, or ask me to walk through any file.
- Note the repo is **public** and includes the planning/report docs (PLAN.md,
  QUESTIONS.md, RESEARCH.md, BUILD-REPORT.md, this file). Harmless, but say
  the word if you'd rather I remove them from the published repo.
- The Telegram project (`~/playground/claude-code-telegram`) is untouched.
- The scratch clone of hermes-agent lives in the session scratchpad and will
  disappear on its own.
