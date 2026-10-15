/**
 * Warns the owner before the Claude subscription sign-in expires.
 *
 * Normal use refreshes the access token, but the refresh token itself has a
 * hard expiry (`claudeAiOauth.refreshTokenExpiresAt` in
 * ~/.claude/.credentials.json) that refreshing does NOT push back — so a
 * re-sign-in is eventually unavoidable, and it's better to hear about it the
 * day before than from a failed run. An hourly check reads that file (no
 * `claude` calls, nothing billed) and DMs the owner once under 48h and once
 * under 12h. Sent warnings are recorded in the settings DB so restarts don't
 * resend; the record resets when the expiry moves (they signed in again).
 *
 * Does nothing with an API key, or when the file/field is missing (e.g. the
 * CLI keeps credentials in the macOS keychain).
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getSetting, setSetting, deleteSetting, logMessage } from './db.ts';
import { ENGINE_LABEL, getAuthMethod } from './engine.ts';
import { ownerDmChannelId, sendDiscord } from './discord.ts';
import { getDashboardUrl } from './dashboard-url.ts';

const CREDENTIALS_PATH = join(
  process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'),
  '.credentials.json'
);
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** Warning tiers, most urgent first; each fires once per expiry value. */
const WARN_HOURS = [12, 48];
const WARNED_KEY = 'auth_expiry_warned_claude';

type WarnedState = { expiresAt: number; sent: number[] };

/** `refreshTokenExpiresAt` (ms epoch) from the credentials file, or null. */
function readRefreshExpiry(): number | null {
  try {
    const j = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8')) as {
      claudeAiOauth?: { refreshTokenExpiresAt?: unknown };
    };
    const v = j?.claudeAiOauth?.refreshTokenExpiresAt;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function readWarned(expiresAt: number): WarnedState {
  try {
    const raw = getSetting(WARNED_KEY);
    const s = raw ? (JSON.parse(raw) as WarnedState) : null;
    if (s && s.expiresAt === expiresAt && Array.isArray(s.sent)) return s;
  } catch {
    // corrupt record — start over
  }
  // First sight of this expiry (or it moved: they signed in again) — reset.
  deleteSetting(WARNED_KEY);
  return { expiresAt, sent: [] };
}

function formatWarning(expiresAt: number): string {
  const unix = Math.floor(expiresAt / 1000);
  const when = expiresAt <= Date.now() ? 'has expired' : `expires <t:${unix}:R>`;
  const url = getDashboardUrl();
  return [
    `⏳ **${ENGINE_LABEL} sign-in ${when}** (<t:${unix}:f>)`,
    'Normal use won’t renew it — a re-sign-in is needed. ' +
      `Open ${url ?? 'the dashboard'}, then under “${ENGINE_LABEL} authentication” ` +
      'tap **Check now** and **Sign in with Claude**.',
  ].join('\n');
}

export async function checkAuthExpiry(): Promise<void> {
  if (getAuthMethod() !== 'subscription') return;
  const expiresAt = readRefreshExpiry();
  if (expiresAt === null) return;

  const state = readWarned(expiresAt);
  const remainingH = (expiresAt - Date.now()) / 3_600_000;
  const due = WARN_HOURS.find((h) => remainingH < h && !state.sent.includes(h));
  if (due === undefined) return;

  const dm = await ownerDmChannelId();
  if (!dm) return;
  const text = formatWarning(expiresAt);
  const r = await sendDiscord(dm, text, { suppressEmbeds: true });
  logMessage({
    direction: 'out',
    text: `[auth-expiry] ${text}`,
    session_id: null,
    ok: r.ok,
    error: r.ok ? null : (r.error ?? null),
  });
  if (!r.ok) return;
  // One message covers this tier and every less urgent one we skipped past.
  state.sent = WARN_HOURS.filter((h) => h >= due);
  setSetting(WARNED_KEY, JSON.stringify(state));
}

export function startAuthExpiryWatch(): void {
  const run = () => checkAuthExpiry().catch((e) => console.error('[auth-expiry]', e));
  // Let the relay finish booting (Discord config, dashboard port) first.
  setTimeout(run, 15_000);
  setInterval(run, CHECK_INTERVAL_MS);
}
