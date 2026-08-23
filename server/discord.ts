/**
 * Discord REST helpers: sending (with 2000-char chunking), typing, threads,
 * DM channels, attachment downloads, and bot/application info.
 *
 * Receiving happens over the Gateway (see discord-listener.ts, which runs a
 * discord.js client); everything outbound goes through plain REST here so it
 * also works for one-off callers (jobs, bin scripts mirror the same calls)
 * and doesn't depend on the gateway connection being up.
 */
import { deleteSetting, getSetting, setSetting } from './db.ts';

export type DiscordConfig = {
  botToken: string | null;
  ownerId: string | null;
  dmChannelId: string | null;
};

export function getDiscordConfig(): DiscordConfig {
  return {
    botToken: getSetting('discord_bot_token'),
    ownerId: getSetting('discord_owner_id'),
    dmChannelId: getSetting('discord_dm_channel_id'),
  };
}

export type BotInfo = { id: string; username: string };

const API = 'https://discord.com/api/v10';

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

/**
 * One REST call. Retries a 429 once after the advised delay; all other
 * failures surface as { ok: false } with Discord's message.
 */
export async function discordApi<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  tokenOverride?: string
): Promise<Ok<T> | Err> {
  const token = tokenOverride ?? getSetting('discord_bot_token');
  if (!token) return { ok: false, error: 'Discord bot token not set' };
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bot ${token}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (res.status === 429 && attempt === 0) {
      const data = (await res.json().catch(() => ({}))) as { retry_after?: number };
      const wait = Math.min(10_000, Math.max(500, (data.retry_after ?? 1) * 1000));
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (res.status === 204) return { ok: true, data: undefined as T };
    const data = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      const message =
        (data && (data.message || JSON.stringify(data).slice(0, 300))) || `HTTP ${res.status}`;
      return { ok: false, error: `Discord ${res.status}: ${message}` };
    }
    return { ok: true, data: data as T };
  }
  return { ok: false, error: 'Discord rate limited (retry exhausted)' };
}

export async function getBotInfo(token: string): Promise<(Ok<never> & { bot: BotInfo }) | Err> {
  const r = await discordApi<{ id: string; username: string }>('GET', '/users/@me', undefined, token);
  if (!r.ok) return r;
  return { ok: true, data: undefined as never, bot: { id: r.data.id, username: r.data.username } };
}

/** The application id behind a bot token (needed for invites + slash commands). */
export async function getApplicationId(token?: string): Promise<string | null> {
  const cached = getSetting('discord_app_id');
  if (cached && !token) return cached;
  const r = await discordApi<{ id: string }>('GET', '/applications/@me', undefined, token);
  return r.ok ? r.data.id : cached;
}

/**
 * Permissions the invite asks for: View Channels, Send Messages, Send Messages
 * in Threads, Create Public Threads, Manage Threads (rename), Embed Links,
 * Attach Files, Read Message History, Add Reactions.
 */
const INVITE_PERMISSIONS =
  (1n << 10n) | // VIEW_CHANNEL
  (1n << 11n) | // SEND_MESSAGES
  (1n << 6n) | // ADD_REACTIONS
  (1n << 14n) | // EMBED_LINKS
  (1n << 15n) | // ATTACH_FILES
  (1n << 16n) | // READ_MESSAGE_HISTORY
  (1n << 34n) | // MANAGE_THREADS
  (1n << 35n) | // CREATE_PUBLIC_THREADS
  (1n << 38n); // SEND_MESSAGES_IN_THREADS

export function inviteUrl(appId: string): string {
  return (
    `https://discord.com/oauth2/authorize?client_id=${appId}` +
    `&scope=bot+applications.commands&permissions=${INVITE_PERMISSIONS.toString()}`
  );
}

// ── Step auto-delete setting ────────────────────────────────────────
//
// How long streamed step messages (🧠 thinking, 🛠 tool calls, ✅ results)
// stay in Discord before the relay deletes them, in seconds. 0 = never
// delete. Final replies are never touched.

const STEP_DELETE_KEY = 'step_delete_seconds';
export const STEP_DELETE_DEFAULT = 60;
/** Choices offered in the dashboard (0 = never); any 0–86400 value is valid. */
export const STEP_DELETE_CHOICES = [0, 30, 60, 300, 900] as const;

export function getStepDeleteSeconds(): number {
  const v = getSetting(STEP_DELETE_KEY);
  if (v === null) return STEP_DELETE_DEFAULT;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : STEP_DELETE_DEFAULT;
}

export function setStepDeleteSeconds(seconds: number): void {
  if (seconds === STEP_DELETE_DEFAULT) deleteSetting(STEP_DELETE_KEY);
  else setSetting(STEP_DELETE_KEY, String(seconds));
}

// ── Sending ─────────────────────────────────────────────────────────

/** Discord's hard cap on message content for bots. */
export const MAX_DISCORD_MESSAGE = 2000;

/**
 * Split markdown near `max`, preferring paragraph then line boundaries, and
 * keep fenced code blocks valid across chunks: a chunk that would leave a
 * fence open gets it closed, and the next chunk reopens it.
 */
export function splitMarkdown(text: string, max = MAX_DISCORD_MESSAGE): string[] {
  // Room for a re-opened fence (``` + language tag) at the top and a closing
  // fence at the bottom of a chunk.
  const budget = max - 40;
  const chunks: string[] = [];
  let rest = text;
  let openFence: string | null = null; // language of the fence left open

  while (rest.length > (openFence ? budget : max)) {
    const limit = budget;
    let cut = rest.lastIndexOf('\n\n', limit);
    if (cut < limit / 2) cut = rest.lastIndexOf('\n', limit);
    if (cut < limit / 2) cut = limit;
    let chunk = rest.slice(0, cut);
    rest = rest.slice(cut).replace(/^\n+/, '');

    if (openFence !== null) chunk = '```' + openFence + '\n' + chunk;

    // Track whether this chunk leaves a code fence open.
    openFence = null;
    let open: string | null = null;
    for (const line of chunk.split('\n')) {
      const m = line.match(/^\s*```(.*)$/);
      if (!m) continue;
      open = open === null ? (m[1] ?? '').trim() : null;
    }
    if (open !== null) {
      openFence = open;
      chunk += '\n```';
    }
    chunks.push(chunk);
  }
  if (rest) chunks.push(openFence !== null ? '```' + openFence + '\n' + rest : rest);
  return chunks;
}

export type SendOptions = {
  /** Suppress link-preview embeds (used for step/status messages). */
  suppressEmbeds?: boolean;
  /** Send with a different token (bin-script parity); defaults to settings. */
  token?: string;
};

const SUPPRESS_EMBEDS_FLAG = 1 << 2;

/**
 * Send markdown to a channel (a thread is just a channel id), chunked at the
 * 2000-char limit. Individual `@user` pings render; @everyone/@here and role
 * pings are always neutralized via allowed_mentions.
 */
export async function sendDiscord(
  channelId: string,
  markdown: string,
  options: SendOptions = {}
): Promise<{ ok: boolean; error?: string; messageIds?: string[] }> {
  if (!markdown.trim()) return { ok: true, messageIds: [] };
  const messageIds: string[] = [];
  for (const chunk of splitMarkdown(markdown)) {
    const r = await discordApi<{ id?: string }>(
      'POST',
      `/channels/${channelId}/messages`,
      {
        content: chunk,
        allowed_mentions: { parse: ['users'] },
        ...(options.suppressEmbeds ? { flags: SUPPRESS_EMBEDS_FLAG } : {}),
      },
      options.token
    );
    if (!r.ok) return { ok: false, error: r.error, messageIds };
    if (r.data?.id) messageIds.push(r.data.id);
  }
  return { ok: true, messageIds };
}

/** Delete one message (bots can always delete their own). */
export async function deleteDiscordMessage(
  channelId: string,
  messageId: string
): Promise<{ ok: boolean; error?: string }> {
  const r = await discordApi('DELETE', `/channels/${channelId}/messages/${messageId}`);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Fire the typing indicator (lasts ~10s; refresh while a run is active). */
export async function sendTyping(channelId: string): Promise<void> {
  await discordApi('POST', `/channels/${channelId}/typing`).catch(() => {});
}

// ── Threads ─────────────────────────────────────────────────────────

/** Start a public thread from a message. Name is capped at Discord's 100 chars. */
export async function createThreadFromMessage(
  channelId: string,
  messageId: string,
  name: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const r = await discordApi<{ id: string }>(
    'POST',
    `/channels/${channelId}/messages/${messageId}/threads`,
    { name: name.slice(0, 100) || 'Claude', auto_archive_duration: 1440 }
  );
  if (!r.ok) return r;
  return { ok: true, id: r.data.id };
}

// ── DMs ─────────────────────────────────────────────────────────────

/** Open (or fetch the existing) DM channel with a user. */
export async function openDmChannel(
  userId: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const r = await discordApi<{ id: string }>('POST', '/users/@me/channels', {
    recipient_id: userId,
  });
  if (!r.ok) return r;
  return { ok: true, id: r.data.id };
}

/** The owner's DM channel — default target for proactive messages. */
export async function ownerDmChannelId(): Promise<string | null> {
  const { ownerId, dmChannelId } = getDiscordConfig();
  if (dmChannelId) return dmChannelId;
  if (!ownerId) return null;
  const r = await openDmChannel(ownerId);
  return r.ok ? r.id : null;
}

// ── Attachments ─────────────────────────────────────────────────────

/** Discord's default upload cap (per file, unboosted servers). */
export const DISCORD_FILE_LIMIT = 25 * 1024 * 1024;

/** Download an attachment by its CDN URL (no auth needed). */
export async function downloadAttachment(
  url: string,
  destPath: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) return { ok: false, error: `download HTTP ${res.status}` };
    const buf = await res.arrayBuffer();
    await Bun.write(destPath, buf);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Session keys ────────────────────────────────────────────────────
//
// Claude resume ids live as settings rows keyed by conversation context.
// The builders live here (not in the listener) so REST-only callers — the
// /api/notify gateway, the job scheduler — can queue pending context under
// the same keys the listener drains.

export const SESSION_PREFIX = 'claude_session_id';

export const dmSessionKey = (channelId: string) => `${SESSION_PREFIX}:dm:${channelId}`;
export const channelSessionKey = (channelId: string) => `${SESSION_PREFIX}:channel:${channelId}`;
export const threadSessionKey = (threadId: string) => `${SESSION_PREFIX}:thread:${threadId}`;

const THREAD_TYPES = new Set([10, 11, 12]); // announcement/public/private thread
const DM_TYPES = new Set([1, 3]); // DM, group DM

/**
 * The session key of the conversation living in a channel id, resolved via
 * one REST lookup (DM → dm:, thread → thread:, else channel:). Falls back to
 * the channel: form when Discord is unreachable.
 */
export async function sessionKeyForChannel(channelId: string): Promise<string> {
  const r = await discordApi<{ type: number }>('GET', `/channels/${channelId}`);
  if (r.ok) {
    if (DM_TYPES.has(r.data.type)) return dmSessionKey(channelId);
    if (THREAD_TYPES.has(r.data.type)) return threadSessionKey(channelId);
  }
  return channelSessionKey(channelId);
}

// ── Guild/channel introspection (dashboard) ─────────────────────────

export type GuildInfo = { id: string; name: string };
export type ChannelInfo = {
  id: string;
  name: string;
  guild_id: string;
  /** Discord channel type (0 = text, 5 = announcement, 15 = forum, …). */
  type: number;
};

export async function listGuilds(): Promise<{ ok: true; guilds: GuildInfo[] } | Err> {
  const r = await discordApi<Array<{ id: string; name: string }>>('GET', '/users/@me/guilds');
  if (!r.ok) return r;
  return { ok: true, guilds: r.data.map((g) => ({ id: g.id, name: g.name })) };
}

/** Text-like channels of a guild (the ones the mode picker cares about). */
export async function listGuildTextChannels(
  guildId: string
): Promise<{ ok: true; channels: ChannelInfo[] } | Err> {
  const r = await discordApi<Array<{ id: string; name: string; type: number; guild_id?: string }>>(
    'GET',
    `/guilds/${guildId}/channels`
  );
  if (!r.ok) return r;
  const TEXT_TYPES = new Set([0, 5]); // GUILD_TEXT, GUILD_ANNOUNCEMENT
  return {
    ok: true,
    channels: r.data
      .filter((c) => TEXT_TYPES.has(c.type))
      .map((c) => ({ id: c.id, name: c.name, guild_id: guildId, type: c.type })),
  };
}
