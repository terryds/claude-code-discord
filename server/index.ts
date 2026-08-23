import { resolve, extname } from 'node:path';
import { existsSync, statSync, readFileSync } from 'node:fs';
import {
  getSetting,
  setSetting,
  deleteSetting,
  recentMessages,
  recentFeed,
  listBookmarks,
  getBookmark,
  addBookmark,
  updateBookmark,
  deleteBookmark,
  listJobs,
  getJob,
  getJobByName,
  addJob,
  updateJob,
  deleteJob,
  logMessage,
  addPendingContext,
} from './db.ts';
import {
  startJobScheduler,
  syncJobs,
  runJobNow,
  nextRunAt,
  validateSchedule,
  isJobRunning,
} from './jobs.ts';
import { fetchBookmarkMeta } from './bookmark-meta.ts';
import {
  getBotInfo,
  getApplicationId,
  getDiscordConfig,
  inviteUrl,
  listGuilds,
  listGuildTextChannels,
  ownerDmChannelId,
  dmSessionKey,
  sessionKeyForChannel,
  sendDiscord,
} from './discord.ts';
import {
  isAuthMethod,
  getAuthConfig,
  setAuthMethod,
  setApiKey,
  getLastAuthProbe,
  saveAuthProbe,
  clearAuthProbe,
} from './engine.ts';
import { claudeEngine } from './claude-runner.ts';
import { getPersona, setPersona, isCustomPersona, DEFAULT_PERSONA } from './persona.ts';
import {
  startClaudeLogin,
  submitClaudeLoginCode,
  cancelClaudeLogin,
  claudeLoginStatus,
} from './claude-login.ts';
import { updateInfo, checkForUpdates, startUpdate } from './updater.ts';
import {
  startListener,
  isRelayEnabled,
  setRelayEnabled,
  setCaptureMode,
  getCapturedUser,
  getDefaultChannelMode,
  setDefaultChannelMode,
  clearAllSessions,
  stopAllRuns,
} from './discord-listener.ts';
import {
  listAllowedUsers,
  addAllowedUser,
  removeAllowedUser,
  listChannelModes,
  setChannelMode,
  clearChannelMode,
  isChannelMode,
} from './db.ts';
import {
  getModel,
  setModel,
  getEffort,
  setEffort,
  isEffortLevel,
  MODEL_ALIASES,
  EFFORT_LEVELS,
} from './engine.ts';
import { setDashboardPort } from './dashboard-url.ts';

// Default to 8100 (distinct from the Telegram relay's 8000, so both can run
// on one host); fall back to 8101 if it's taken. An explicit PORT env var
// always wins and is used as-is (no fallback).
const PORT_CANDIDATES = process.env.PORT ? [Number(process.env.PORT)] : [8100, 8101];
const CLIENT_DIR = resolve('./dist/client');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(init.headers || {}),
    },
  });
}

function err(status: number, message: string): Response {
  return json({ error: message }, { status });
}

async function readBody<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

function isOnboarded(): boolean {
  return Boolean(getSetting('discord_bot_token') && getSetting('discord_owner_id'));
}

/** "myapp.example.com:3001" — the fallback bookmark title when a page has none. */
function hostLabel(url: string): string {
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return url;
  }
}

/** Whether an edited URL actually points somewhere new (ignoring scheme guessing). */
function normalizedUrlChanged(input: string, current: string): boolean {
  const strip = (s: string) => s.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return strip(input) !== strip(current);
}

/** Rough plain-text rendering of an HTML message, for Discord + agent context. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** The slice of Bun.Server the API needs (the full type is generic across bun-types versions). */
type RequestIPServer = { requestIP(req: Request): { address: string } | null };

async function handleApi(req: Request, url: URL, server?: RequestIPServer): Promise<Response> {
  const p = url.pathname.replace(/^\/api/, '') || '/';
  const m = req.method;

  // Notification gateway for other services on this host: deliver to the
  // owner's DM (or an explicit channel), record in the dashboard feed, and
  // queue a plain-text summary the agent sees on that conversation's next
  // turn. Loopback-only; contract in the README ("Notification gateway").
  if (p === '/notify' && m === 'POST') {
    const ip = server?.requestIP(req)?.address;
    if (ip && ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
      return err(401, 'notify is loopback-only');
    }
    const requiredToken = getSetting('notify_token');
    if (requiredToken && req.headers.get('x-notify-token') !== requiredToken) {
      return err(401, 'bad or missing X-Notify-Token header');
    }
    const body = await readBody<{
      text?: unknown;
      format?: unknown;
      source?: unknown;
      kind?: unknown;
      context?: unknown;
      no_context?: unknown;
      channel_id?: unknown;
      mode?: unknown;
    }>(req);
    const rawText = typeof body.text === 'string' ? body.text.trim() : '';
    const source = typeof body.source === 'string' ? body.source.trim() : '';
    const kind = typeof body.kind === 'string' && body.kind.trim() ? body.kind.trim() : null;
    if (!rawText) return err(400, 'text is required');
    if (!source) return err(400, 'source is required');
    if (body.mode !== undefined && body.mode !== 'deliver') {
      return err(400, 'unsupported mode — only "deliver" exists ("agent" is reserved)');
    }
    // Discord renders Markdown natively, so "md" and "plain" send as-is;
    // "html" (the Telegram relay's default — accepted so the same payload
    // works against both relays) is stripped to plain text first.
    const format = body.format === undefined ? 'md' : body.format;
    if (format !== 'html' && format !== 'plain' && format !== 'md') {
      return err(400, 'format must be "md", "plain", or "html"');
    }
    const text = format === 'html' ? stripHtml(rawText) : rawText;
    if (!text) return err(400, 'text is empty after HTML stripping');
    if (!isOnboarded()) return err(503, 'relay not linked to a Discord owner yet');

    const explicitChannel =
      typeof body.channel_id === 'string' && body.channel_id.trim()
        ? body.channel_id.trim()
        : null;
    const dm = explicitChannel ? null : await ownerDmChannelId();
    const dest = explicitChannel ?? dm;
    if (!dest) return err(503, "couldn't resolve the owner's DM channel");

    const r = await sendDiscord(dest, text);
    logMessage({
      direction: 'out',
      text: `[${source}${kind ? ` · ${kind}` : ''}] ${text}`,
      session_id: null,
      ok: r.ok,
      error: r.ok ? null : (r.error ?? null),
    });
    // Non-2xx on failure so callers with retry semantics can retry later.
    if (!r.ok) return err(502, r.error ?? 'Discord send failed');
    if (body.no_context !== true) {
      const context =
        typeof body.context === 'string' && body.context.trim()
          ? body.context.trim()
          : stripHtml(text);
      if (context) {
        // Queue under the conversation the alert landed in, so the next
        // message *there* gets the FYI.
        const sessionKey = explicitChannel
          ? await sessionKeyForChannel(explicitChannel)
          : dmSessionKey(dest);
        addPendingContext({ source, kind, text: context, sessionKey });
      }
    }
    return json({ ok: true });
  }

  if (p === '/status' && m === 'GET') {
    const cfg = getDiscordConfig();
    const bot = cfg.botToken
      ? await getBotInfo(cfg.botToken).then((r) => (r.ok ? r.bot : null))
      : null;
    const appId = cfg.botToken ? await getApplicationId() : null;
    return json({
      onboarded: isOnboarded(),
      bot_token_set: Boolean(cfg.botToken),
      bot,
      invite_url: appId ? inviteUrl(appId) : null,
      owner_id: cfg.ownerId,
      owner_username: getSetting('discord_owner_username'),
      relay_enabled: isRelayEnabled(),
      default_mode: getDefaultChannelMode(),
      model: getModel(),
      effort: getEffort(),
      auth: { ...getAuthConfig(), last: getLastAuthProbe() },
    });
  }

  // Verify the Claude CLI is installed. `/claude-check` kept as an alias.
  if ((p === '/agent-check' || p === '/claude-check') && m === 'GET') {
    const result = await claudeEngine.check();
    return json(result);
  }

  // Live-probe whether the CLI is authenticated. Slow (runs a tiny real turn).
  if (p === '/auth-check' && m === 'GET') {
    const result = await claudeEngine.checkAuth();
    // Cache the outcome so the dashboard can show auth state without
    // re-probing on every load.
    const rec = saveAuthProbe(result);
    return json({ ...result, checked_at: rec.checked_at });
  }

  // Read the persisted auth setup (method + whether a key is saved) and the
  // last cached probe result, without probing. Used by the dashboard to render
  // the current state cheaply.
  if (p === '/auth-config' && m === 'GET') {
    return json({ ...getAuthConfig(), last: getLastAuthProbe() });
  }

  // Update auth setup: switch method and/or save (or clear) the API key.
  if (p === '/auth-config' && m === 'POST') {
    const body = await readBody<{ method?: string; apiKey?: string }>(req);
    if (body.method !== undefined) {
      if (!isAuthMethod(body.method)) {
        return err(400, 'method must be "subscription" or "apikey"');
      }
      setAuthMethod(body.method);
      clearAuthProbe(); // setup changed — the cached probe no longer applies
    }
    // An explicit empty string clears the saved key; undefined leaves it alone.
    if (body.apiKey !== undefined) {
      setApiKey(body.apiKey);
      clearAuthProbe();
    }
    return json({ ok: true, ...getAuthConfig() });
  }

  // Claude subscription sign-in, driven from the dashboard (no terminal).
  // Start → returns the authorize URL; the user authorizes and pastes the code.
  if (p === '/auth/claude-login/start' && m === 'POST') {
    try {
      return json(await startClaudeLogin());
    } catch (e) {
      return err(400, e instanceof Error ? e.message : String(e));
    }
  }

  if (p === '/auth/claude-login/code' && m === 'POST') {
    const body = await readBody<{ code?: string }>(req);
    const result = await submitClaudeLoginCode(body.code || '');
    if (!result.ok) return err(400, result.error || 'Sign-in failed.');
    return json({ ok: true });
  }

  // Poll the in-progress sign-in: { state: 'idle'|'awaiting'|'done'|'error' }.
  if (p === '/auth/claude-login/status' && m === 'GET') {
    return json(claudeLoginStatus());
  }

  if (p === '/auth/claude-login/cancel' && m === 'POST') {
    cancelClaudeLogin();
    return json({ ok: true });
  }

  if (p === '/persona' && m === 'GET') {
    return json({
      persona: getPersona(),
      custom: isCustomPersona(),
      default_persona: DEFAULT_PERSONA,
    });
  }

  if (p === '/persona' && m === 'POST') {
    const body = await readBody<{ persona?: string }>(req);
    // Persona is injected at session start, so stop in-flight runs and clear
    // sessions — the next message picks it up in a fresh conversation.
    stopAllRuns();
    clearAllSessions();
    setPersona(body.persona ?? '');
    return json({ ok: true, persona: getPersona(), custom: isCustomPersona() });
  }

  if (p === '/onboarding/save-token' && m === 'POST') {
    const body = await readBody<{ token?: string }>(req);
    const token = (body.token || '').trim();
    if (!token) return err(400, 'Token required');
    const r = await getBotInfo(token);
    if (!r.ok) return err(400, `Invalid token: ${r.error}`);
    setSetting('discord_bot_token', token);
    // Reset any prior owner link so capture starts fresh; resolve and cache
    // the application id (used for the invite URL and slash commands).
    deleteSetting('discord_owner_id');
    deleteSetting('discord_owner_username');
    deleteSetting('discord_dm_channel_id');
    const appId = await getApplicationId(token);
    if (appId) setSetting('discord_app_id', appId);
    return json({ ok: true, bot: r.bot, invite_url: appId ? inviteUrl(appId) : null });
  }

  if (p === '/onboarding/start-capture' && m === 'POST') {
    if (!getSetting('discord_bot_token')) return err(400, 'Save a bot token first');
    setCaptureMode(true);
    return json({ ok: true });
  }

  if (p === '/onboarding/captured' && m === 'GET') {
    const c = getCapturedUser();
    return json({ user_id: c?.user_id ?? null, username: c?.username ?? null });
  }

  if (p === '/onboarding/cancel-capture' && m === 'POST') {
    setCaptureMode(false);
    return json({ ok: true });
  }

  // Allowed users: who may talk to the bot. The onboarding user is the owner
  // (first row, matches discord_owner_id) and can't be removed.
  if (p === '/allowed-users' && m === 'GET') {
    return json({ users: listAllowedUsers(), owner_id: getSetting('discord_owner_id') });
  }

  if (p === '/allowed-users' && m === 'POST') {
    const body = await readBody<{ user_id?: string; username?: string }>(req);
    const userId = (body.user_id || '').trim();
    if (!/^\d{5,25}$/.test(userId)) {
      return err(400, 'user_id must be a Discord user id (a long number)');
    }
    addAllowedUser(userId, (body.username || '').trim() || null);
    return json({ ok: true, users: listAllowedUsers() });
  }

  const auDelete = p.match(/^\/allowed-users\/(\d+)$/);
  if (auDelete && m === 'DELETE') {
    const userId = auDelete[1];
    if (userId === getSetting('discord_owner_id')) {
      return err(400, "The owner can't be removed");
    }
    if (!removeAllowedUser(userId)) return err(404, 'No such user');
    return json({ ok: true, users: listAllowedUsers() });
  }

  // Channels & response modes: the bot's guilds' text channels merged with the
  // saved per-channel overrides, plus the global default mode.
  if (p === '/channels' && m === 'GET') {
    const overrides = listChannelModes();
    const g = await listGuilds();
    if (!g.ok) {
      // Still show saved overrides so the page works while Discord is down.
      return json({
        default_mode: getDefaultChannelMode(),
        guilds: [],
        channels: [],
        overrides,
        error: g.error,
      });
    }
    const channels: Array<{ id: string; name: string; guild_id: string; guild_name: string }> = [];
    for (const guild of g.guilds) {
      const c = await listGuildTextChannels(guild.id);
      if (!c.ok) continue;
      for (const ch of c.channels) {
        channels.push({ id: ch.id, name: ch.name, guild_id: guild.id, guild_name: guild.name });
      }
    }
    return json({ default_mode: getDefaultChannelMode(), guilds: g.guilds, channels, overrides });
  }

  if (p === '/channel-mode' && m === 'POST') {
    const body = await readBody<{
      channel_id?: string;
      mode?: string;
      channel_name?: string;
      guild_name?: string;
    }>(req);
    const channelId = (body.channel_id || '').trim();
    if (!channelId) return err(400, 'channel_id required');
    const mode = (body.mode || '').trim();
    if (mode === 'default') {
      clearChannelMode(channelId);
      return json({ ok: true });
    }
    if (!isChannelMode(mode)) {
      return err(400, 'mode must be "free", "mention", "ignore", or "default"');
    }
    setChannelMode(channelId, mode, {
      channel_name: body.channel_name ?? null,
      guild_name: body.guild_name ?? null,
    });
    return json({ ok: true });
  }

  if (p === '/default-mode' && m === 'POST') {
    const body = await readBody<{ mode?: string }>(req);
    const mode = (body.mode || '').trim();
    if (!isChannelMode(mode)) return err(400, 'mode must be "free", "mention", or "ignore"');
    setDefaultChannelMode(mode);
    return json({ ok: true, default_mode: mode });
  }

  // Model & effort passed to `claude -p` (--model / --effort). Empty clears.
  if (p === '/model' && m === 'GET') {
    return json({
      model: getModel(),
      effort: getEffort(),
      model_aliases: MODEL_ALIASES,
      effort_levels: EFFORT_LEVELS,
    });
  }

  if (p === '/model' && m === 'POST') {
    const body = await readBody<{ model?: string; effort?: string }>(req);
    if (body.model !== undefined) setModel(body.model);
    if (body.effort !== undefined) {
      const e = body.effort.trim();
      if (e && !isEffortLevel(e)) {
        return err(400, `effort must be one of ${EFFORT_LEVELS.join(', ')} (or empty to clear)`);
      }
      setEffort(e);
    }
    return json({ ok: true, model: getModel(), effort: getEffort() });
  }

  if (p === '/relay' && m === 'POST') {
    const body = await readBody<{ enabled?: boolean }>(req);
    const enabled = Boolean(body.enabled);
    if (enabled && !isOnboarded()) return err(400, 'Finish onboarding first');
    setRelayEnabled(enabled);
    return json({ ok: true, enabled });
  }

  // Self-update: version info, remote check (git fetch), and launch of
  // bin/safe-update-relay (detached — it restarts this process via pm2).
  if (p === '/update/info' && m === 'GET') {
    return json(updateInfo());
  }

  if (p === '/update/check' && m === 'POST') {
    const r = checkForUpdates();
    if (!r.ok) return err(502, r.error);
    return json(r);
  }

  if (p === '/update/run' && m === 'POST') {
    const r = startUpdate();
    if (!r.ok) return err(409, r.error);
    return json({ ok: true });
  }

  // Bookmarks: quick links to other apps (often ones the agent deployed on
  // other ports of this host), shown at the top of the dashboard. Creating or
  // changing a URL fetches the page's title + favicon server-side.
  if (p === '/bookmarks' && m === 'GET') {
    return json({ bookmarks: listBookmarks() });
  }

  if (p === '/bookmarks' && m === 'POST') {
    const body = await readBody<{ url?: string; title?: string }>(req);
    const rawUrl = (body.url || '').trim();
    if (!rawUrl) return err(400, 'URL required');
    const meta = await fetchBookmarkMeta(rawUrl);
    const explicitTitle = (body.title || '').trim();
    const title = explicitTitle || meta.title || hostLabel(meta.url);
    const bookmark = addBookmark({ url: meta.url, title, favicon: meta.favicon });
    return json({ ok: true, bookmark });
  }

  const bmEdit = p.match(/^\/bookmarks\/(\d+)$/);
  if (bmEdit && m === 'POST') {
    const id = Number(bmEdit[1]);
    const existing = getBookmark(id);
    if (!existing) return err(404, 'No such bookmark');
    const body = await readBody<{ url?: string; title?: string }>(req);
    const rawUrl = (body.url ?? '').trim();
    const explicitTitle = (body.title ?? '').trim();

    if (rawUrl && normalizedUrlChanged(rawUrl, existing.url)) {
      // URL changed — refetch metadata for the new target.
      const meta = await fetchBookmarkMeta(rawUrl);
      const bookmark = updateBookmark(id, {
        url: meta.url,
        title: explicitTitle || meta.title || hostLabel(meta.url),
        favicon: meta.favicon,
      });
      return json({ ok: true, bookmark });
    }

    const bookmark = updateBookmark(id, explicitTitle ? { title: explicitTitle } : {});
    return json({ ok: true, bookmark });
  }

  if (bmEdit && m === 'DELETE') {
    if (!deleteBookmark(Number(bmEdit[1]))) return err(404, 'No such bookmark');
    return json({ ok: true });
  }

  const bmRefresh = p.match(/^\/bookmarks\/(\d+)\/refresh$/);
  if (bmRefresh && m === 'POST') {
    const id = Number(bmRefresh[1]);
    const existing = getBookmark(id);
    if (!existing) return err(404, 'No such bookmark');
    const meta = await fetchBookmarkMeta(existing.url);
    // Only overwrite fields the fetch actually produced — a temporarily-down
    // app shouldn't wipe the icon and title we already have.
    const bookmark = updateBookmark(id, {
      ...(meta.title ? { title: meta.title } : {}),
      ...(meta.favicon ? { favicon: meta.favicon } : {}),
    });
    return json({ ok: true, bookmark, reachable: Boolean(meta.title || meta.favicon) });
  }

  // Scheduled jobs: watcher scripts registered by the agent (via bin/job) or
  // the dashboard, run on a cron schedule by server/jobs.ts. Rows are the
  // source of truth — every mutation ends with syncJobs() to reconcile the
  // in-process Bun.cron registrations.
  if (p === '/jobs' && m === 'GET') {
    const jobs = listJobs().map((j) => ({
      ...j,
      next_run_at: j.enabled ? nextRunAt(j.schedule) : null,
      running: isJobRunning(j.id),
    }));
    return json({ jobs });
  }

  if (p === '/jobs' && m === 'POST') {
    const body = await readBody<{
      name?: string;
      description?: string;
      schedule?: string;
      script_path?: string;
      channel_id?: string;
    }>(req);
    const name = (body.name || '').trim();
    const schedule = (body.schedule || '').trim();
    const scriptPath = resolve((body.script_path || '').trim());
    const channelId = (body.channel_id || '').trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name)) {
      return err(400, 'name must be a short slug (letters, digits, - and _)');
    }
    if (!schedule) return err(400, 'schedule (cron expression) required');
    const bad = validateSchedule(schedule);
    if (bad) return err(400, `invalid schedule: ${bad}`);
    if (!body.script_path || !existsSync(scriptPath)) {
      return err(400, `script not found: ${scriptPath}`);
    }
    const existing = getJobByName(name);
    // Delivery channel is required — the user must have named where alerts go
    // (their DM channel id counts as an explicit choice).
    if (!channelId && !existing?.channel_id) {
      return err(400, 'channel_id (Discord delivery channel) required');
    }
    // Upsert by name so re-registering a watcher updates it in place.
    const job = existing
      ? updateJob(existing.id, {
          // Empty description on a re-register keeps the existing one.
          description: (body.description || '').trim() || existing.description,
          schedule,
          script_path: scriptPath,
          ...(channelId ? { channel_id: channelId } : {}),
        })
      : addJob({
          name,
          description: (body.description || '').trim(),
          schedule,
          script_path: scriptPath,
          channel_id: channelId,
        });
    syncJobs();
    return json({ ok: true, job: { ...job!, next_run_at: nextRunAt(job!.schedule) } });
  }

  const jobEdit = p.match(/^\/jobs\/(\d+)$/);
  if (jobEdit && m === 'POST') {
    const id = Number(jobEdit[1]);
    if (!getJob(id)) return err(404, 'No such job');
    const body = await readBody<{
      description?: string;
      schedule?: string;
      script_path?: string;
      channel_id?: string;
      enabled?: boolean;
    }>(req);
    if (body.schedule !== undefined) {
      const bad = validateSchedule(body.schedule.trim());
      if (bad) return err(400, `invalid schedule: ${bad}`);
    }
    if (body.script_path !== undefined && !existsSync(resolve(body.script_path))) {
      return err(400, `script not found: ${resolve(body.script_path)}`);
    }
    const job = updateJob(id, {
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.schedule !== undefined ? { schedule: body.schedule.trim() } : {}),
      ...(body.script_path !== undefined ? { script_path: resolve(body.script_path) } : {}),
      ...(body.channel_id !== undefined ? { channel_id: body.channel_id.trim() } : {}),
      ...(body.enabled !== undefined ? { enabled: Boolean(body.enabled) } : {}),
    });
    syncJobs();
    return json({ ok: true, job });
  }

  if (jobEdit && m === 'DELETE') {
    if (!deleteJob(Number(jobEdit[1]))) return err(404, 'No such job');
    syncJobs();
    return json({ ok: true });
  }

  const jobRun = p.match(/^\/jobs\/(\d+)\/run$/);
  if (jobRun && m === 'POST') {
    const r = await runJobNow(Number(jobRun[1]));
    if ('error' in r) return err(409, r.error);
    return json({ ok: true, ...r });
  }

  if (p === '/reset-session' && m === 'POST') {
    stopAllRuns();
    clearAllSessions();
    return json({ ok: true });
  }

  if (p === '/messages' && m === 'GET') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);
    return json({ messages: recentMessages(limit) });
  }

  if (p === '/feed' && m === 'GET') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 300), 1000);
    return json({ events: recentFeed(limit) });
  }

  if (p === '/reset' && m === 'POST') {
    stopAllRuns();
    setRelayEnabled(false);
    deleteSetting('discord_bot_token');
    deleteSetting('discord_app_id');
    deleteSetting('discord_owner_id');
    deleteSetting('discord_owner_username');
    deleteSetting('discord_dm_channel_id');
    clearAllSessions();
    deleteSetting('captured_user_id');
    deleteSetting('captured_username');
    deleteSetting('capture_user');
    return json({ ok: true });
  }

  return err(404, 'Not found');
}

function serveStatic(url: URL): Response {
  if (!existsSync(CLIENT_DIR)) {
    return new Response(
      [
        'Client not built yet.',
        '',
        'Run `bun run build` to build the client, or `bun run dev` for hot-reload development.',
        '',
        `Looked in: ${CLIENT_DIR}`,
      ].join('\n'),
      { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }
  const safePath = url.pathname.replace(/\.\./g, '');
  let filePath = resolve(CLIENT_DIR, '.' + safePath);
  if (!filePath.startsWith(CLIENT_DIR)) return new Response('Forbidden', { status: 403 });

  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    stat = null;
  }

  if (!stat || stat.isDirectory()) {
    filePath = resolve(CLIENT_DIR, 'index.html');
    try {
      stat = statSync(filePath);
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }

  const ext = extname(filePath).toLowerCase();
  const ct = MIME[ext] || 'application/octet-stream';
  const data = readFileSync(filePath);
  return new Response(data, { headers: { 'Content-Type': ct } });
}

startListener();
startJobScheduler();

const fetchHandler = async (req: Request, server?: RequestIPServer) => {
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api')) {
    try {
      return await handleApi(req, url, server);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[api] error:', msg);
      return err(500, msg);
    }
  }
  return serveStatic(url);
};

function serve() {
  for (const port of PORT_CANDIDATES) {
    try {
      return Bun.serve({ port, fetch: fetchHandler });
    } catch (e) {
      const isInUse = e instanceof Error && /EADDRINUSE|in use|address already/i.test(e.message);
      const isLast = port === PORT_CANDIDATES[PORT_CANDIDATES.length - 1];
      if (!isInUse || isLast) throw e;
      console.warn(`port ${port} is in use, trying ${PORT_CANDIDATES[PORT_CANDIDATES.indexOf(port) + 1]}…`);
    }
  }
  throw new Error('no port available');
}

const server = serve();
setDashboardPort(server.port);

console.log(`claude-code-discord-coworker listening on http://localhost:${server.port}`);
