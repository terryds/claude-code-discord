/**
 * Shared types + persisted auth config for the Claude Code engine.
 *
 * The relay drives Claude Code headlessly: spawn `claude -p` once per Discord
 * message, stream intermediate steps (thinking, tool calls, results) back
 * live, and return a final result. Conversations are continued by resuming a
 * session id.
 */
import { getSetting, setSetting, deleteSetting } from './db.ts';

export const ENGINE_LABEL = 'Claude Code';

// ── Streamed steps ──────────────────────────────────────────────────

export type StepKind = 'thinking' | 'tool_use' | 'tool_result' | 'text';

export type EngineStep = {
  kind: StepKind;
  ts: string; // HH:MM:SS
  toolName?: string; // for tool_use
  toolInput?: string; // truncated input
  resultText?: string; // for tool_result
  text?: string; // for text blocks
};

export type OnStep = (step: EngineStep) => void | Promise<void>;

// ── Results ─────────────────────────────────────────────────────────

export type AskQuestionOption = { label: string; description?: string };
export type AskQuestion = {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: AskQuestionOption[];
};

export type EngineResult =
  | { ok: true; text: string; session_id: string | null; questions?: AskQuestion[] }
  | { ok: false; error: string; aborted?: boolean; staleSession?: boolean };

export type EngineCheck = {
  installed: boolean;
  version?: string;
  path?: string;
  error?: string;
};

// ── Auth ────────────────────────────────────────────────────────────

export type AuthMethod = 'subscription' | 'apikey';

/** Result of a live auth probe (a real one-shot run against the CLI). */
export type EngineAuth = {
  /** The probe completed a turn successfully — the CLI is usable. */
  authed: boolean;
  /** The configured auth method. */
  method: AuthMethod;
  /** Whether an API key is saved (only meaningful when method === 'apikey'). */
  hasKey: boolean;
  /** Explanation surfaced when not authed (the CLI's error, or a hint). */
  error?: string;
};

/** Persisted auth setup, without running a probe. */
export type AuthConfig = { method: AuthMethod; hasKey: boolean };

/** The engine surface the listener drives. */
export interface Engine {
  id: 'claude';
  label: string;
  /** Verify the CLI is installed and usable. */
  check(): Promise<EngineCheck>;
  /**
   * Live-probe whether the CLI is authenticated, using the configured auth
   * method (subscription login, or an injected saved API key).
   */
  checkAuth(): Promise<EngineAuth>;
  /**
   * Run one turn. Streams steps via `onStep` while working, honours `signal`
   * for user-initiated stops, and resolves with the final result. `sessionId`
   * is null for a fresh conversation, otherwise the id to resume.
   */
  run(
    prompt: string,
    sessionId: string | null,
    signal: AbortSignal | undefined,
    onStep: OnStep
  ): Promise<EngineResult>;
}

// ── Auth config (persisted) ─────────────────────────────────────────

/** Env var the CLI reads its API key from when using API-key auth. */
export const API_KEY_ENV = 'ANTHROPIC_API_KEY';

export function isAuthMethod(v: string): v is AuthMethod {
  return v === 'subscription' || v === 'apikey';
}

// Settings keys keep their historical `_claude` suffix (harmless, and keeps
// any copied-over DB working).
const AUTH_METHOD_KEY = 'auth_method_claude';
const API_KEY_KEY = 'api_key_claude';
const OAUTH_TOKEN_KEY = 'oauth_token_claude';
const AUTH_PROBE_KEY = 'auth_probe_claude';

export function getAuthMethod(): AuthMethod {
  const v = getSetting(AUTH_METHOD_KEY);
  return v && isAuthMethod(v) ? v : 'subscription';
}

export function setAuthMethod(method: AuthMethod): void {
  setSetting(AUTH_METHOD_KEY, method);
}

export function getApiKey(): string | null {
  return getSetting(API_KEY_KEY);
}

/** Save (or, with an empty string, clear) the API key. */
export function setApiKey(key: string): void {
  const k = key.trim();
  if (k) setSetting(API_KEY_KEY, k);
  else deleteSetting(API_KEY_KEY);
}

/**
 * Legacy long-lived subscription OAuth token (the old `claude setup-token`
 * onboarding stored one here). New sign-ins use `claude auth login`, which
 * writes credentials to the host itself and clears this. While a token is
 * still present (installs that haven't re-signed-in), it's injected as
 * CLAUDE_CODE_OAUTH_TOKEN so they keep working.
 */
export function getOauthToken(): string | null {
  return getSetting(OAUTH_TOKEN_KEY);
}

export function setOauthToken(token: string): void {
  const t = token.trim();
  if (t) setSetting(OAUTH_TOKEN_KEY, t);
  else deleteSetting(OAUTH_TOKEN_KEY);
}

export function getAuthConfig(): AuthConfig {
  return { method: getAuthMethod(), hasKey: Boolean(getApiKey()) };
}

// ── Cached auth probe ───────────────────────────────────────────────
//
// A live probe is slow and consumes a real request, so the dashboard shouldn't
// re-probe on every load. Persist the last probe's outcome and serve that
// instantly; it's invalidated whenever the auth setup changes.

export type AuthProbeRecord = {
  authed: boolean;
  method: AuthMethod;
  error?: string;
  checked_at: number;
};

export function getLastAuthProbe(): AuthProbeRecord | null {
  const raw = getSetting(AUTH_PROBE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthProbeRecord;
  } catch {
    return null;
  }
}

export function saveAuthProbe(probe: EngineAuth): AuthProbeRecord {
  const rec: AuthProbeRecord = {
    authed: probe.authed,
    method: probe.method,
    ...(probe.error ? { error: probe.error } : {}),
    checked_at: Date.now(),
  };
  setSetting(AUTH_PROBE_KEY, JSON.stringify(rec));
  return rec;
}

export function clearAuthProbe(): void {
  deleteSetting(AUTH_PROBE_KEY);
}

/**
 * Env overrides to apply when spawning the CLI:
 *  - API-key auth: inject the saved key under ANTHROPIC_API_KEY.
 *  - Subscription auth: nothing — the CLI uses the host's own login — unless a
 *    legacy setup-token is still stored, in which case inject it.
 */
export function authEnv(): Record<string, string> {
  if (getAuthMethod() === 'apikey') {
    const key = getApiKey();
    return key ? { [API_KEY_ENV]: key } : {};
  }
  const token = getOauthToken();
  if (token) return { CLAUDE_CODE_OAUTH_TOKEN: token };
  return {};
}

// ── Model & effort selection ────────────────────────────────────────
//
// Global settings passed to `claude -p` as --model / --effort. Empty/absent
// means "let the CLI use its own default". Changing them does NOT reset
// sessions — the next turn just runs with the new flags.

const MODEL_KEY = 'claude_model';
const EFFORT_KEY = 'claude_effort';

/** Common aliases offered in the dashboard; any full model id is also valid. */
export const MODEL_ALIASES = ['fable', 'opus', 'sonnet', 'haiku'] as const;

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export function isEffortLevel(v: string): v is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(v);
}

export function getModel(): string | null {
  const v = getSetting(MODEL_KEY);
  return v && v.trim() ? v.trim() : null;
}

export function setModel(model: string): void {
  const m = model.trim();
  if (m) setSetting(MODEL_KEY, m);
  else deleteSetting(MODEL_KEY);
}

export function getEffort(): EffortLevel | null {
  const v = getSetting(EFFORT_KEY);
  return v && isEffortLevel(v) ? v : null;
}

export function setEffort(effort: string): void {
  const e = effort.trim();
  if (e && isEffortLevel(e)) setSetting(EFFORT_KEY, e);
  else deleteSetting(EFFORT_KEY);
}

/** Current HH:MM:SS, for steps whose source events carry no timestamp. */
export function nowTs(): string {
  return new Date().toISOString().slice(11, 19);
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
