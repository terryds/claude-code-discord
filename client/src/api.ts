async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && 'error' in body && String((body as any).error)) ||
      `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

export type BotInfo = { id: string; username: string };

export type AuthMethod = 'subscription' | 'apikey';
export type AuthProbe = {
  authed: boolean;
  method: AuthMethod;
  error?: string;
  checked_at: number;
};
export type AuthConfig = { method: AuthMethod; hasKey: boolean; last?: AuthProbe | null };
export type EngineAuth = {
  authed: boolean;
  method: AuthMethod;
  hasKey: boolean;
  error?: string;
  checked_at?: number;
};

export type PersonaInfo = {
  persona: string;
  custom: boolean;
  default_persona: string;
};

export type ChannelMode = 'free' | 'mention' | 'ignore';

export type AllowedUser = { user_id: string; username: string | null; added_at: number };

export type ChannelModeRow = {
  channel_id: string;
  mode: ChannelMode;
  channel_name: string | null;
  guild_name: string | null;
  updated_at: number;
};

export type GuildInfo = { id: string; name: string };

export type ChannelListing = {
  default_mode: ChannelMode;
  guilds: GuildInfo[];
  channels: Array<{ id: string; name: string; guild_id: string; guild_name: string }>;
  overrides: ChannelModeRow[];
  error?: string;
};

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type Status = {
  onboarded: boolean;
  bot_token_set: boolean;
  bot: BotInfo | null;
  invite_url: string | null;
  owner_id: string | null;
  owner_username: string | null;
  relay_enabled: boolean;
  default_mode: ChannelMode;
  model: string | null;
  effort: EffortLevel | null;
  auth: AuthConfig;
};

export type CommitInfo = { sha: string; subject: string; date?: string };

export type UpdateState = {
  phase: 'running' | 'failed' | 'success';
  step?: string;
  detail?: string;
  old?: string;
  new?: string;
  ts: number;
};

export type UpdateInfo = {
  current: CommitInfo | null;
  managed: boolean;
  running: boolean;
  state: UpdateState | null;
};

export type UpdateCheck = { ok: true; behind: number; commits: CommitInfo[] };

export type AgentCheck = {
  installed: boolean;
  version?: string;
  path?: string;
  error?: string;
};
/** @deprecated use AgentCheck */
export type ClaudeCheck = AgentCheck;

export type Bookmark = {
  id: number;
  url: string;
  title: string;
  favicon: string | null; // data: URI, fetched server-side
  created_at: number;
  updated_at: number;
};

export type Job = {
  id: number;
  name: string;
  description: string;
  schedule: string; // 5-field cron expression, UTC
  script_path: string;
  channel_id: string | null; // Discord delivery channel
  enabled: number;
  created_at: number;
  updated_at: number;
  last_run_at: number | null;
  last_exit_code: number | null;
  last_output: string | null;
  consecutive_failures: number;
  next_run_at: number | null;
  running: boolean;
};

export type MessageLogEntry = {
  id: number;
  created_at: number;
  direction: 'in' | 'out';
  text: string;
  session_id: string | null;
  ok: boolean;
  error: string | null;
};

export type FeedEvent =
  | {
      etype: 'message';
      id: number;
      created_at: number;
      direction: 'in' | 'out';
      text: string;
      session_id: string | null;
      ok: boolean;
      error: string | null;
    }
  | {
      etype: 'step';
      id: number;
      created_at: number;
      session_id: string | null;
      kind: 'thinking' | 'tool_use' | 'tool_result';
      tool_name: string | null;
      tool_input: string | null;
      result_text: string | null;
    };

export const api = {
  status: () => request<Status>('/status'),
  agentCheck: () => request<AgentCheck>('/agent-check'),
  authCheck: () => request<EngineAuth>('/auth-check'),
  authConfig: () => request<AuthConfig>('/auth-config'),
  setAuthConfig: (body: { method?: AuthMethod; apiKey?: string }) =>
    request<{ ok: true } & AuthConfig>('/auth-config', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  claudeLoginStart: () =>
    request<{ url: string }>('/auth/claude-login/start', { method: 'POST' }),
  claudeLoginCode: (code: string) =>
    request<{ ok: true }>('/auth/claude-login/code', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  claudeLoginStatus: () =>
    request<{ state: 'idle' | 'awaiting' | 'done' | 'error'; error?: string }>(
      '/auth/claude-login/status'
    ),
  claudeLoginCancel: () =>
    request<{ ok: true }>('/auth/claude-login/cancel', { method: 'POST' }),
  persona: () => request<PersonaInfo>('/persona'),
  setPersona: (persona: string) =>
    request<{ ok: true; persona: string; custom: boolean }>('/persona', {
      method: 'POST',
      body: JSON.stringify({ persona }),
    }),
  saveToken: (token: string) =>
    request<{ ok: true; bot: BotInfo; invite_url: string | null }>('/onboarding/save-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  startCapture: () =>
    request<{ ok: true }>('/onboarding/start-capture', { method: 'POST' }),
  cancelCapture: () =>
    request<{ ok: true }>('/onboarding/cancel-capture', { method: 'POST' }),
  captured: () =>
    request<{ user_id: string | null; username: string | null }>('/onboarding/captured'),
  allowedUsers: () =>
    request<{ users: AllowedUser[]; owner_id: string | null }>('/allowed-users'),
  addAllowedUser: (user_id: string, username?: string) =>
    request<{ ok: true; users: AllowedUser[] }>('/allowed-users', {
      method: 'POST',
      body: JSON.stringify({ user_id, username }),
    }),
  removeAllowedUser: (user_id: string) =>
    request<{ ok: true; users: AllowedUser[] }>(`/allowed-users/${user_id}`, {
      method: 'DELETE',
    }),
  channels: () => request<ChannelListing>('/channels'),
  setChannelMode: (body: {
    channel_id: string;
    mode: ChannelMode | 'default';
    channel_name?: string;
    guild_name?: string;
  }) =>
    request<{ ok: true }>('/channel-mode', { method: 'POST', body: JSON.stringify(body) }),
  setDefaultMode: (mode: ChannelMode) =>
    request<{ ok: true; default_mode: ChannelMode }>('/default-mode', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),
  modelConfig: () =>
    request<{
      model: string | null;
      effort: EffortLevel | null;
      model_aliases: string[];
      effort_levels: EffortLevel[];
    }>('/model'),
  setModelConfig: (body: { model?: string; effort?: string }) =>
    request<{ ok: true; model: string | null; effort: EffortLevel | null }>('/model', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  setRelay: (enabled: boolean) =>
    request<{ ok: true; enabled: boolean }>('/relay', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  bookmarks: () => request<{ bookmarks: Bookmark[] }>('/bookmarks'),
  addBookmark: (body: { url: string; title?: string }) =>
    request<{ ok: true; bookmark: Bookmark }>('/bookmarks', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateBookmark: (id: number, body: { url?: string; title?: string }) =>
    request<{ ok: true; bookmark: Bookmark }>(`/bookmarks/${id}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteBookmark: (id: number) =>
    request<{ ok: true }>(`/bookmarks/${id}`, { method: 'DELETE' }),
  refreshBookmark: (id: number) =>
    request<{ ok: true; bookmark: Bookmark; reachable: boolean }>(
      `/bookmarks/${id}/refresh`,
      { method: 'POST' }
    ),
  jobs: () => request<{ jobs: Job[] }>('/jobs'),
  updateJob: (
    id: number,
    body: { description?: string; schedule?: string; enabled?: boolean }
  ) =>
    request<{ ok: true; job: Job }>(`/jobs/${id}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteJob: (id: number) =>
    request<{ ok: true }>(`/jobs/${id}`, { method: 'DELETE' }),
  runJob: (id: number) =>
    request<{ ok: true; exit_code: number; output: string; sent: boolean }>(
      `/jobs/${id}/run`,
      { method: 'POST' }
    ),
  updateInfo: () => request<UpdateInfo>('/update/info'),
  updateCheck: () => request<UpdateCheck>('/update/check', { method: 'POST' }),
  updateRun: () => request<{ ok: true }>('/update/run', { method: 'POST' }),
  resetSession: () => request<{ ok: true }>('/reset-session', { method: 'POST' }),
  messages: (limit = 50) =>
    request<{ messages: MessageLogEntry[] }>(`/messages?limit=${limit}`),
  feed: (limit = 300) =>
    request<{ events: FeedEvent[] }>(`/feed?limit=${limit}`),
  reset: () => request<{ ok: true }>('/reset', { method: 'POST' }),
};
