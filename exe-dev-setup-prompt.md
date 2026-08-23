# exe.dev Setup Prompt for claude-code-discord-coworker

Paste this into exe.dev's `--prompt` (or the box at <https://exe.dev/new>) to set
up and run the relay. exe.dev's image ships the `claude` CLI, and you
**authenticate it from the dashboard** during onboarding — so this prompt just
gets the relay running and hands you the URL to open. No terminal login.

## The prompt

```
Set up and run the "claude-code-discord-coworker" project on this VM, then give me the URL to open for onboarding.

It's a self-hosted relay that forwards Discord messages to Claude Code running here and sends replies back. Stack: Bun + React/Vite + Tailwind + SQLite + discord.js. The `claude` CLI is already installed on this image — do NOT reinstall it, and do NOT try to log it in from the terminal. Authentication (subscription sign-in or API key) is done in the dashboard during onboarding.

1. Clone https://github.com/terryds/claude-code-discord.git into ~/claude-code-discord and cd into it.
2. Run `bin/doctor`. If any core dependency is missing (bun, node, npm, pm2, git, jq, sqlite3, python3), run `bin/install` (idempotent, uses sudo) and re-check. Do NOT touch the claude CLI. (python3 is needed for Claude's in-dashboard subscription sign-in.)
3. Build: `bun install` then `bun run build`.
4. Start it under pm2 on port 8100 with bun as the interpreter:
     cd ~/claude-code-discord
     PORT=8100 pm2 start server/index.ts --name claude-code-discord-coworker --interpreter "$(which bun)" --max-restarts 10 --restart-delay 3000
     pm2 save
     pm2 startup   # run the command it prints so it survives reboot
5. Confirm it's listening on 8100 with no errors (`pm2 logs claude-code-discord-coworker --lines 20`).
6. Tell me the URL for port 8100 on this VM — that's the dashboard. Use the VM's full domain name (from `hostname -f`, e.g. https://<vm-name>.exe.xyz:8100) — do NOT give me an IP-address URL. I'll finish setup there myself: sign in to Claude (subscription, right in the page — or paste an API key), then create a Discord bot in the Developer Portal and paste its token (the page walks me through it, including the privileged intents and the invite link).

Do NOT set the Discord bot token, and do NOT authenticate the claude CLI — those happen in the dashboard onboarding UI.
```

## Run it

Pipe the prompt from stdin (cleanest for long prompts):

```bash
ssh exe.dev new --name=discord-coworker --cpu=2 --memory=4GB --disk=20GB --prompt=/dev/stdin < exe-prompt.txt
```

…or paste it into the "Describe your VM" box at <https://exe.dev/new>.

## After it reports the URL

Open the dashboard URL the agent gives you (e.g. `https://<vm-name>.exe.xyz:8100`)
and complete onboarding — all in the browser, no terminal:

1. **Authenticate Claude Code.** The page checks the CLI is installed and
   whether it's signed in. If not: **Subscription** — click **Sign in with
   Claude**, open the link, authorize. Or **API key** — paste an Anthropic key.
2. **Create your Discord bot.** Follow the on-page steps: New Application in
   the [Developer Portal](https://discord.com/developers/applications), toggle
   ON **Message Content Intent** + **Server Members Intent** (Bot tab), Reset
   Token, paste it — then open the generated invite link and authorize the bot
   into your server.
3. **Say hi.** Send the bot any message (server channel or DM) — the first
   message links you as the owner.

Then you're on the dashboard and the relay is live.

## Notes

- **The dashboard has no built-in auth.** Put exe.dev's access controls in
  front of port 8100 (don't expose it openly — anyone who reaches it can edit
  the allowlist, re-onboard, and get a shell on the VM).
- Recommended specs: 2 CPU / 4 GB / 20 GB disk; Ubuntu image (auto-detected).
- Auth (subscription login / API key), bot token, owner link, allowlist,
  channel modes, and sessions all live in `data/app.db` and survive restarts.
  Keep the `claude` CLI current.
- Update later: `cd ~/claude-code-discord && git pull && bun install && bun run build && pm2 restart claude-code-discord-coworker` — or run `bin/safe-update-relay`.
