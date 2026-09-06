import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import {
  api,
  type AllowedUser,
  type Bookmark,
  type ChannelListing,
  type ChannelMode,
  type CommitInfo,
  type EffortLevel,
  type FeedEvent,
  type Job,
  type Status,
  type UpdateInfo,
} from '../api';
import { AgentAuth } from '../components/AgentAuth';
import { Nav } from '../components/Nav';

type Props = { status: Status; onChange: () => void };

const engineLabel = 'Claude Code';

export function Dashboard({ status, onChange }: Props) {
  const [, setLocation] = useLocation();
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const loadFeed = async () => {
    try {
      const r = await api.feed(300);
      setEvents(r.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    loadFeed();
    const id = window.setInterval(loadFeed, 3000);
    return () => window.clearInterval(id);
  }, []);

  // Newest events render at the top. Keep the view pinned there as they stream
  // in, but only if the user is already near the top — don't yank them back up
  // while they're scrolled down reading older activity.
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    if (el.scrollTop < 120) el.scrollTop = 0;
  }, [events]);

  const toggleRelay = async () => {
    setBusy('relay');
    setError(null);
    try {
      await api.setRelay(!status.relay_enabled);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const resetSession = async () => {
    setBusy('session');
    setError(null);
    try {
      await api.resetSession();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const resetAll = async () => {
    if (!confirm('Reset bot token, owner link, and sessions? You will need to re-onboard.')) {
      return;
    }
    setBusy('reset');
    setError(null);
    try {
      await api.reset();
      onChange();
      setLocation('/onboarding');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-full max-w-4xl mx-auto px-6 py-10 space-y-8">
      <Nav />
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-zinc-400 text-sm mt-1">
            {status.bot ? (
              <>
                Connected as{' '}
                <span className="font-mono text-zinc-200">@{status.bot.username}</span>
                {status.owner_username && (
                  <>
                    {' '}· owner{' '}
                    <span className="font-mono text-zinc-300">@{status.owner_username}</span>
                  </>
                )}
              </>
            ) : (
              'No bot connected'
            )}
          </p>
          {status.bot && (
            <a
              href="https://discord.com/channels/@me"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#5865F2] hover:bg-[#4752c4] transition-colors"
            >
              {/* Discord mark */}
              <svg viewBox="0 0 640 512" className="w-4 h-4 fill-current" aria-hidden="true">
                <path d="M524.5 69.8a1.5 1.5 0 0 0-.8-.7A485.1 485.1 0 0 0 404.1 32a1.8 1.8 0 0 0-1.9.9 337.5 337.5 0 0 0-14.9 30.6 447.8 447.8 0 0 0-134.4 0 309.5 309.5 0 0 0-15.1-30.6 1.9 1.9 0 0 0-1.9-.9A483.7 483.7 0 0 0 116.1 69.1a1.7 1.7 0 0 0-.8.7C39.1 183.7 18.2 294.7 28.4 404.4a2 2 0 0 0 .8 1.4A487.7 487.7 0 0 0 176 479.9a1.9 1.9 0 0 0 2.1-.7A348.2 348.2 0 0 0 208.1 430.4a1.9 1.9 0 0 0-1-2.6 321.2 321.2 0 0 1-45.9-21.9 1.9 1.9 0 0 1-.2-3.1c3.1-2.3 6.2-4.7 9.1-7.1a1.8 1.8 0 0 1 1.9-.3c96.3 44 200.6 44 295.8 0a1.8 1.8 0 0 1 1.9.2c2.9 2.4 6 4.9 9.1 7.2a1.9 1.9 0 0 1-.2 3.1 301.4 301.4 0 0 1-45.9 21.8 1.9 1.9 0 0 0-1 2.6 391.1 391.1 0 0 0 30 48.8 1.9 1.9 0 0 0 2.1.7A486 486 0 0 0 610.7 405.7a1.9 1.9 0 0 0 .8-1.4c12.2-126.7-20.6-236.8-87-334.5zM222.5 337.6c-29 0-52.8-26.6-52.8-59.2s23.4-59.3 52.8-59.3c29.7 0 53.3 26.8 52.8 59.2 0 32.7-23.4 59.3-52.8 59.3zm195.4 0c-29 0-52.8-26.6-52.8-59.2s23.4-59.3 52.8-59.3c29.7 0 53.3 26.8 52.8 59.2 0 32.7-23.1 59.3-52.8 59.3z" />
              </svg>
              Open Discord
            </a>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span
            className={[
              'inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium',
              status.relay_enabled
                ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-800'
                : 'bg-zinc-800 text-zinc-400 border border-zinc-700',
            ].join(' ')}
          >
            <span
              className={[
                'w-1.5 h-1.5 rounded-full',
                status.relay_enabled ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500',
              ].join(' ')}
            />
            {status.relay_enabled ? 'Relay on' : 'Relay off'}
          </span>
        </div>
      </header>

      {error && (
        <div className="bg-red-950/40 border border-red-900/60 text-red-200 rounded p-3 text-sm">
          {error}
        </div>
      )}

      <section>
        <h2 className="font-medium mb-3 text-sm uppercase tracking-wide text-zinc-400">
          Bookmarks
        </h2>
        <BookmarksCard />
      </section>

      <section>
        <h2 className="font-medium mb-3 text-sm uppercase tracking-wide text-zinc-400">
          Scheduled jobs
        </h2>
        <JobsCard />
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          onClick={toggleRelay}
          disabled={busy === 'relay'}
          className={[
            'p-4 rounded-lg border text-left transition-colors disabled:opacity-50',
            status.relay_enabled
              ? 'border-zinc-700 bg-zinc-900 hover:bg-zinc-800'
              : 'border-blue-700 bg-blue-950/40 hover:bg-blue-950/60',
          ].join(' ')}
        >
          <div className="font-medium text-sm">
            {status.relay_enabled ? 'Pause relay' : 'Enable relay'}
          </div>
          <div className="text-xs text-zinc-400 mt-1">
            {status.relay_enabled
              ? `Stop forwarding incoming messages to ${engineLabel}.`
              : `Start forwarding incoming messages to ${engineLabel}.`}
          </div>
        </button>

        <button
          onClick={resetSession}
          disabled={busy === 'session'}
          className="p-4 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-left transition-colors disabled:opacity-50"
        >
          <div className="font-medium text-sm">Reset {engineLabel} sessions</div>
          <div className="text-xs text-zinc-400 mt-1">
            Clears every conversation (DMs, channels, and threads alike).
          </div>
        </button>

        <button
          onClick={resetAll}
          disabled={busy === 'reset'}
          className="p-4 rounded-lg border border-red-900/60 bg-red-950/20 hover:bg-red-950/40 text-left transition-colors disabled:opacity-50"
        >
          <div className="font-medium text-sm text-red-200">Reset everything</div>
          <div className="text-xs text-red-300/70 mt-1">
            Clear bot token, owner link, and sessions.
          </div>
        </button>
      </section>

      <section>
        <h2 className="font-medium mb-3 text-sm uppercase tracking-wide text-zinc-400">
          Channels & response modes
        </h2>
        <ChannelsCard defaultMode={status.default_mode} onChange={onChange} />
      </section>

      <section>
        <h2 className="font-medium mb-3 text-sm uppercase tracking-wide text-zinc-400">
          Allowed users
        </h2>
        <AllowedUsersCard />
      </section>

      <section>
        <h2 className="font-medium mb-3 text-sm uppercase tracking-wide text-zinc-400">
          Model
        </h2>
        <ModelCard />
      </section>

      <section>
        <h2 className="font-medium mb-3 text-sm uppercase tracking-wide text-zinc-400">
          Step messages
        </h2>
        <StepDeleteCard />
      </section>

      <section>
        <h2 className="font-medium mb-3 text-sm uppercase tracking-wide text-zinc-400">
          Persona
        </h2>
        <PersonaCard />
      </section>

      <section>
        <h2 className="font-medium mb-3 text-sm uppercase tracking-wide text-zinc-400">
          {engineLabel} authentication
        </h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
          {/* Skip the auto-probe here — probing costs a request; the user
              clicks Check. */}
          <AgentAuth autoProbe={false} />
        </div>
      </section>

      <section>
        <h2 className="font-medium mb-3 text-sm uppercase tracking-wide text-zinc-400">
          Updates
        </h2>
        <UpdateCard />
      </section>

      <section>
        <h2 className="font-medium mb-3 text-sm uppercase tracking-wide text-zinc-400">
          Activity
        </h2>
        {events.length === 0 ? (
          <p className="text-zinc-500 text-sm">No activity yet.</p>
        ) : (
          <div
            ref={feedRef}
            className="max-h-[65vh] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2"
          >
            {events.map((e) => (
              <FeedItem key={`${e.etype}-${e.id}`} event={e} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PersonaCard() {
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [custom, setCustom] = useState(false);
  const [defaultPersona, setDefaultPersona] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api
      .persona()
      .then((r) => {
        setText(r.persona);
        setSaved(r.persona);
        setCustom(r.custom);
        setDefaultPersona(r.default_persona);
        setLoaded(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const dirty = text !== saved;

  const save = async (value: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.setPersona(value);
      setText(r.persona);
      setSaved(r.persona);
      setCustom(r.custom);
      setNotice('Saved — the next Discord message starts a fresh conversation with it.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5 text-sm text-zinc-500">
        {error ?? 'Loading…'}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5 space-y-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-zinc-400 text-xs">
          Who the assistant is to you on Discord. Injected at the start of every
          conversation — also editable via <code className="text-zinc-300">/persona</code> in chat.
        </p>
        <span
          className={[
            'shrink-0 px-2 py-0.5 rounded-full text-xs font-medium border',
            custom
              ? 'bg-blue-950/40 text-blue-300 border-blue-800'
              : 'bg-zinc-800 text-zinc-400 border-zinc-700',
          ].join(' ')}
        >
          {custom ? 'Customized' : 'Default'}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setNotice(null);
        }}
        rows={7}
        spellCheck={false}
        className="w-full rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2.5 font-mono text-xs leading-relaxed resize-y focus:outline-none focus:border-zinc-600"
      />
      {error && <p className="text-red-300 text-xs">{error}</p>}
      {notice && <p className="text-emerald-300 text-xs">{notice}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={() => save(text)}
          disabled={busy || !dirty || !text.trim()}
          className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors disabled:opacity-50"
        >
          Save persona
        </button>
        {custom && (
          <button
            onClick={() => save('')}
            disabled={busy}
            className="px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-xs transition-colors disabled:opacity-50"
          >
            Reset to default
          </button>
        )}
        {!custom && dirty && (
          <button
            onClick={() => setText(defaultPersona)}
            disabled={busy}
            className="px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-xs transition-colors disabled:opacity-50"
          >
            Discard changes
          </button>
        )}
        <span className="text-zinc-500 text-xs">
          Saving stops in-flight runs and starts fresh conversations.
        </span>
      </div>
    </div>
  );
}

function JobsCard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [openOutput, setOpenOutput] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await api.jobs();
      setJobs(r.jobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    load();
    // The agent registers jobs from Discord runs, and run states change on
    // their own — keep the list fresh.
    const id = window.setInterval(load, 5000);
    return () => window.clearInterval(id);
  }, []);

  const withBusy = async (id: number, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const fmt = (ts: number) =>
    new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const statusDot = (j: Job) => {
    if (!j.enabled) return 'bg-zinc-600';
    if (j.running) return 'bg-blue-400 animate-pulse';
    if (j.last_run_at === null) return 'bg-zinc-400';
    return j.last_exit_code === 0 ? 'bg-emerald-400' : 'bg-red-400';
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 space-y-3">
      {error && <p className="text-red-300 text-sm">{error}</p>}
      {loaded && jobs.length === 0 && (
        <p className="text-zinc-500 text-sm">
          No scheduled jobs yet. Ask the agent over Discord to watch something —
          e.g. “check the bitcoin price every hour and tell me if it drops below
          $50k” — and it will create one.
        </p>
      )}
      {jobs.map((j) => (
        <div
          key={j.id}
          className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2.5"
        >
          <div className="flex items-center gap-3">
            <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot(j)}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-medium text-sm">{j.name}</span>
                <code className="text-xs text-zinc-400">{j.schedule} UTC</code>
                {j.channel_id && (
                  <span className="text-xs text-zinc-500" title="Delivery channel">
                    → <code className="text-zinc-400">{j.channel_id}</code>
                  </span>
                )}
                {!j.enabled && (
                  <span className="text-xs text-zinc-500">(paused)</span>
                )}
              </div>
              {j.description && (
                <p className="text-xs text-zinc-400 mt-0.5 truncate">{j.description}</p>
              )}
              <p className="text-xs text-zinc-500 mt-0.5">
                {j.running
                  ? 'running now…'
                  : j.last_run_at
                    ? `last run ${fmt(j.last_run_at)}${
                        j.last_exit_code === 0 ? '' : ` — failed (exit ${j.last_exit_code})`
                      }`
                    : 'never ran yet'}
                {j.enabled && j.next_run_at ? ` · next ${fmt(j.next_run_at)}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {j.last_output && (
                <button
                  onClick={() => setOpenOutput(openOutput === j.id ? null : j.id)}
                  className="px-2 py-1 rounded text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
                  title="Show last output"
                >
                  {openOutput === j.id ? 'Hide output' : 'Output'}
                </button>
              )}
              <button
                onClick={() => withBusy(j.id, () => api.runJob(j.id))}
                disabled={busyId === j.id || j.running}
                className="px-2 py-1 rounded text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors disabled:opacity-50"
                title="Run once now (delivers output to Discord)"
              >
                Run now
              </button>
              <button
                onClick={() =>
                  withBusy(j.id, () => api.updateJob(j.id, { enabled: !j.enabled }))
                }
                disabled={busyId === j.id}
                className="px-2 py-1 rounded text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors disabled:opacity-50"
              >
                {j.enabled ? 'Pause' : 'Resume'}
              </button>
              <button
                onClick={() => {
                  if (!confirm(`Remove scheduled job "${j.name}"?`)) return;
                  withBusy(j.id, () => api.deleteJob(j.id));
                }}
                disabled={busyId === j.id}
                className="px-2 py-1 rounded text-xs text-zinc-500 hover:bg-red-950/40 hover:text-red-300 transition-colors disabled:opacity-50"
                title="Remove job"
              >
                ✕
              </button>
            </div>
          </div>
          {openOutput === j.id && j.last_output && (
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-zinc-950 border border-zinc-800 p-2 text-xs text-zinc-300 whitespace-pre-wrap">
              {j.last_output}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

function BookmarksCard() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Which form is open: 'add', a bookmark id (edit), or null.
  const [editing, setEditing] = useState<'add' | number | null>(null);
  const [formUrl, setFormUrl] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await api.bookmarks();
      setBookmarks(r.bookmarks);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    load();
    // The agent adds bookmarks from Discord runs — pick those up while the
    // dashboard sits open, without hammering the API.
    const id = window.setInterval(load, 15000);
    return () => window.clearInterval(id);
  }, []);

  const openAdd = () => {
    setEditing('add');
    setFormUrl('');
    setFormTitle('');
    setError(null);
  };

  const openEdit = (b: Bookmark) => {
    setEditing(b.id);
    setFormUrl(b.url);
    setFormTitle(b.title);
    setError(null);
  };

  const closeForm = () => {
    setEditing(null);
    setError(null);
  };

  const submit = async () => {
    const url = formUrl.trim();
    if (!url) return;
    setSaving(true);
    setError(null);
    try {
      if (editing === 'add') {
        await api.addBookmark({ url, title: formTitle.trim() || undefined });
      } else if (typeof editing === 'number') {
        await api.updateBookmark(editing, { url, title: formTitle.trim() || undefined });
      }
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const refreshMeta = async () => {
    if (typeof editing !== 'number') return;
    setSaving(true);
    setError(null);
    try {
      const r = await api.refreshBookmark(editing);
      if (!r.reachable) {
        setError("Couldn't reach the page — kept the existing title and icon.");
      } else {
        setEditing(null);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (b: Bookmark) => {
    if (!confirm(`Remove bookmark "${b.title}"?`)) return;
    setBusyId(b.id);
    setError(null);
    try {
      await api.deleteBookmark(b.id);
      if (editing === b.id) setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const formOpen = editing !== null;

  return (
    <div className="space-y-3">
      {loaded && bookmarks.length === 0 && !formOpen && (
        <p className="text-zinc-400 text-sm">
          Quick links to your other apps — anything running on another port or host.
          New projects the agent deploys get added here automatically.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {bookmarks.map((b) => (
          <div
            key={b.id}
            className="group relative rounded-lg border border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900/70 hover:border-zinc-700 transition-colors"
          >
            <a
              href={b.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 p-3 pr-16"
              title={b.url}
            >
              <BookmarkIcon bookmark={b} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-zinc-100 truncate">
                  {b.title}
                </span>
                <span className="block text-xs text-zinc-500 truncate">
                  {displayHost(b.url)}
                </span>
              </span>
            </a>
            <span className="absolute top-1/2 -translate-y-1/2 right-2 flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
              <button
                onClick={() => openEdit(b)}
                className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                title="Edit bookmark"
                aria-label={`Edit ${b.title}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                </svg>
              </button>
              <button
                onClick={() => remove(b)}
                disabled={busyId === b.id}
                className="p-1.5 rounded text-zinc-400 hover:text-red-300 hover:bg-red-950/40 disabled:opacity-50"
                title="Remove bookmark"
                aria-label={`Remove ${b.title}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </span>
          </div>
        ))}

        {!formOpen && loaded && (
          <button
            onClick={openAdd}
            className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-zinc-200 p-3 text-sm transition-colors min-h-[3.5rem]"
          >
            <span className="text-base leading-none">+</span> Add bookmark
          </button>
        )}
      </div>

      {formOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4 space-y-3 text-sm"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">
                URL
              </span>
              <input
                autoFocus
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder="myapp.example.com:3001"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-600"
              />
            </label>
            <label className="block">
              <span className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">
                Title <span className="normal-case text-zinc-600">(optional)</span>
              </span>
              <input
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Fetched from the page if left empty"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-600"
              />
            </label>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="submit"
              disabled={saving || !formUrl.trim()}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm font-medium"
            >
              {saving
                ? 'Fetching title & icon…'
                : editing === 'add'
                  ? 'Add'
                  : 'Save'}
            </button>
            {typeof editing === 'number' && (
              <button
                type="button"
                onClick={refreshMeta}
                disabled={saving}
                className="px-3 py-1.5 border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 rounded text-sm disabled:opacity-50"
                title="Fetch the page again and update its title and icon"
              >
                Re-fetch title & icon
              </button>
            )}
            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
              className="text-zinc-400 hover:text-zinc-200 underline disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-red-400">{error}</p>}
        </form>
      )}

      {error && !formOpen && <p className="text-red-400 text-sm">{error}</p>}
    </div>
  );
}

/** Favicon if we have one; otherwise a colored letter tile derived from the host. */
function BookmarkIcon({ bookmark }: { bookmark: Bookmark }) {
  const [broken, setBroken] = useState(false);
  if (bookmark.favicon && !broken) {
    return (
      <img
        src={bookmark.favicon}
        alt=""
        onError={() => setBroken(true)}
        className="w-6 h-6 rounded shrink-0 object-contain"
      />
    );
  }
  const letter = (bookmark.title.trim()[0] ?? '?').toUpperCase();
  const hue = hostHue(bookmark.url);
  return (
    <span
      className="w-6 h-6 rounded shrink-0 flex items-center justify-center text-xs font-semibold text-white"
      style={{ backgroundColor: `hsl(${hue} 45% 40%)` }}
      aria-hidden
    >
      {letter}
    </span>
  );
}

function hostHue(url: string): number {
  let h = 0;
  const s = displayHost(url);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function displayHost(url: string): string {
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return url;
  }
}

function UpdateCard() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [check, setCheck] = useState<{ behind: number; commits: CommitInfo[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const loadInfo = async () => {
    try {
      const r = await api.updateInfo();
      setInfo(r);
      // A restart may have happened while this page was open — an update
      // "running" per the state file means we should be in the polling UI.
      if (r.running) setUpdating(true);
      return r;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    loadInfo();
  }, []);

  const runCheck = async () => {
    setError(null);
    setChecking(true);
    try {
      const r = await api.updateCheck();
      setCheck({ behind: r.behind, commits: r.commits });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  const runUpdate = async () => {
    if (!confirm('Pull the latest version, rebuild, and restart the relay?')) return;
    setError(null);
    try {
      await api.updateRun();
      setUpdating(true);
      setCheck(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // While updating, poll until the (restarted) server reports the outcome.
  // Fetch failures are expected mid-restart — keep polling through them.
  useEffect(() => {
    if (!updating) return;
    let stopped = false;
    const tick = async () => {
      const r = await loadInfo();
      if (stopped) return;
      if (r && !r.running) {
        setUpdating(false);
        return;
      }
      pollRef.current = window.setTimeout(tick, 2000);
    };
    pollRef.current = window.setTimeout(tick, 2000);
    return () => {
      stopped = true;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [updating]);

  const state = info?.state ?? null;
  const outcome =
    !updating && state && state.phase !== 'running'
      ? state.phase === 'success'
        ? state.old && state.new && state.old !== state.new
          ? `Last update: ✅ ${state.old} → ${state.new}`
          : 'Last update: ✅ already up to date (rebuilt + restarted)'
        : `Last update: ❌ failed at ${state.step ?? '?'}${state.detail ? ` — ${state.detail}` : ''}`
      : null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5 text-sm space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-zinc-100">
            Current version:{' '}
            {info?.current ? (
              <>
                <code className="text-zinc-300">{info.current.sha}</code>{' '}
                <span className="text-zinc-400">{info.current.subject}</span>
              </>
            ) : (
              <span className="text-zinc-500">unknown</span>
            )}
          </p>
          {info?.current?.date && (
            <p className="text-zinc-500 text-xs mt-0.5">
              committed {new Date(info.current.date).toLocaleString()}
            </p>
          )}
        </div>
        {!updating && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={runCheck}
              disabled={checking}
              className="px-3 py-1.5 border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 rounded text-xs font-medium disabled:opacity-50"
            >
              {checking ? 'Checking…' : 'Check for updates'}
            </button>
            {info?.managed && check && check.behind > 0 && (
              <button
                onClick={runUpdate}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium"
              >
                Update now
              </button>
            )}
          </div>
        )}
      </div>

      {updating ? (
        <div className="flex items-center gap-2 text-zinc-300">
          <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
          Updating — pull, build, restart. The dashboard will reconnect by itself…
        </div>
      ) : (
        <>
          {check &&
            (check.behind === 0 ? (
              <p className="text-emerald-400">Up to date.</p>
            ) : (
              <div className="space-y-1">
                <p className="text-zinc-200">
                  Update available — {check.behind} commit{check.behind === 1 ? '' : 's'} behind:
                </p>
                <ul className="text-xs text-zinc-400 space-y-0.5">
                  {check.commits.map((c) => (
                    <li key={c.sha}>
                      <code className="text-zinc-500">{c.sha}</code> {c.subject}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          {info && !info.managed && (
            <p className="text-zinc-500 text-xs">
              Not running under pm2 — updates must be applied manually (git pull, bun run
              build, restart). You can also send <code>/update</code> to the bot when
              deployed.
            </p>
          )}
          {outcome && <p className="text-zinc-500 text-xs">{outcome}</p>}
        </>
      )}

      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}

const MODE_LABELS: Record<ChannelMode, string> = {
  free: 'Free responses',
  mention: 'Mention → thread',
  ignore: 'Ignored',
};

const MODE_HELP: Record<ChannelMode, string> = {
  free: 'The bot replies to every allowed user without a mention. End a message with " /t" to branch into a thread with a fresh session.',
  mention: 'The bot only responds when @mentioned, and replies in a new thread with a fresh session.',
  ignore: 'The bot never responds in the channel.',
};

function ChannelsCard({
  defaultMode,
  onChange,
}: {
  defaultMode: ChannelMode;
  onChange: () => void;
}) {
  const [listing, setListing] = useState<ChannelListing | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await api.channels();
      setListing(r);
      if (r.error) setError(`Couldn't reach Discord: ${r.error}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setDefault = async (mode: ChannelMode) => {
    setBusy('default');
    setError(null);
    try {
      await api.setDefaultMode(mode);
      await load();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const setMode = async (
    ch: { id: string; name: string; guild_name: string },
    mode: ChannelMode | 'default'
  ) => {
    setBusy(ch.id);
    setError(null);
    try {
      await api.setChannelMode({
        channel_id: ch.id,
        mode,
        channel_name: ch.name,
        guild_name: ch.guild_name,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const overrideFor = (channelId: string): ChannelMode | null =>
    listing?.overrides.find((o) => o.channel_id === channelId)?.mode ?? null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5 text-sm space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1.5">
          Default mode (channels without an override)
        </div>
        <div className="inline-flex rounded-lg border border-zinc-700 overflow-hidden text-sm font-medium">
          {(['free', 'mention', 'ignore'] as ChannelMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setDefault(m)}
              disabled={busy === 'default'}
              className={[
                'px-3 py-1.5 transition-colors disabled:opacity-50',
                defaultMode === m
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800',
              ].join(' ')}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <p className="text-zinc-500 text-xs mt-1.5">{MODE_HELP[defaultMode]}</p>
      </div>

      {listing === null ? (
        <p className="text-zinc-500">Loading channels…</p>
      ) : listing.channels.length === 0 ? (
        <p className="text-zinc-400">
          No channels visible yet — invite the bot to a server (and give it View
          Channel access) and they'll show up here.
        </p>
      ) : (
        <div className="space-y-2">
          {listing.channels.map((ch) => {
            const override = overrideFor(ch.id);
            return (
              <div
                key={ch.id}
                className="flex items-center justify-between gap-3 rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-zinc-100 truncate">
                    <span className="font-medium">#{ch.name}</span>{' '}
                    <span className="text-zinc-500">· {ch.guild_name}</span>
                  </p>
                  <p className="text-zinc-500 text-xs">
                    <code className="text-zinc-400">{ch.id}</code>
                    {override === null && (
                      <span> · using default ({MODE_LABELS[defaultMode]})</span>
                    )}
                  </p>
                </div>
                <select
                  value={override ?? 'default'}
                  disabled={busy === ch.id}
                  onChange={(e) => setMode(ch, e.target.value as ChannelMode | 'default')}
                  className="shrink-0 bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-600 disabled:opacity-50"
                >
                  <option value="default">Default</option>
                  <option value="free">{MODE_LABELS.free}</option>
                  <option value="mention">{MODE_LABELS.mention}</option>
                  <option value="ignore">{MODE_LABELS.ignore}</option>
                </select>
              </div>
            );
          })}
          <p className="text-zinc-500 text-xs">
            DMs always answer. Threads the bot created keep answering without a
            mention, each with its own contained session.
          </p>
        </div>
      )}

      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}

function AllowedUsersCard() {
  const [users, setUsers] = useState<AllowedUser[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await api.allowedUsers();
      setUsers(r.users);
      setOwnerId(r.owner_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    if (!newId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.addAllowedUser(newId.trim(), newName.trim() || undefined);
      setNewId('');
      setNewName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (u: AllowedUser) => {
    if (!confirm(`Remove ${u.username ? `@${u.username}` : u.user_id} from the allowlist?`))
      return;
    setBusy(true);
    setError(null);
    try {
      await api.removeAllowedUser(u.user_id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5 text-sm space-y-3">
      <p className="text-zinc-400 text-xs">
        Only these Discord users can talk to the bot — everyone else is silently
        ignored. Find a user's ID in Discord via Settings → Advanced → Developer
        Mode, then right-click the user → Copy User ID.
      </p>
      {loaded && users.length === 0 && (
        <p className="text-zinc-500">No users yet — finish onboarding to add the owner.</p>
      )}
      <div className="space-y-2">
        {users.map((u) => (
          <div
            key={u.user_id}
            className="flex items-center justify-between gap-3 rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-zinc-100 truncate">
                <span className="font-medium">{u.username ? `@${u.username}` : 'unknown'}</span>
                {u.user_id === ownerId && (
                  <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-950/60 text-blue-300 border border-blue-800">
                    owner
                  </span>
                )}
              </p>
              <p className="text-zinc-500 text-xs">
                <code className="text-zinc-400">{u.user_id}</code>
              </p>
            </div>
            {u.user_id !== ownerId && (
              <button
                onClick={() => remove(u)}
                disabled={busy}
                className="shrink-0 px-3 py-1.5 border border-red-900/60 bg-red-950/20 hover:bg-red-950/40 text-red-200 rounded text-xs font-medium disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="flex gap-2 flex-wrap"
      >
        <input
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          placeholder="Discord user ID (long number)"
          className="flex-1 min-w-[180px] bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-600"
        />
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="username (optional label)"
          className="w-44 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-600"
        />
        <button
          type="submit"
          disabled={busy || !newId.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-xs font-medium"
        >
          Add user
        </button>
      </form>
      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}

function ModelCard() {
  const [model, setModelState] = useState<string | null>(null);
  const [effort, setEffortState] = useState<EffortLevel | null>(null);
  const [aliases, setAliases] = useState<string[]>(['fable', 'opus', 'sonnet', 'haiku']);
  const [efforts, setEfforts] = useState<EffortLevel[]>(['low', 'medium', 'high', 'xhigh', 'max']);
  const [customModel, setCustomModel] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await api.modelConfig();
      setModelState(r.model);
      setEffortState(r.effort);
      setAliases(r.model_aliases);
      setEfforts(r.effort_levels);
      setCustomModel(r.model && !r.model_aliases.includes(r.model) ? r.model : '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const apply = async (body: { model?: string; effort?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.setModelConfig(body);
      setModelState(r.model);
      setEffortState(r.effort);
      if (body.model !== undefined) {
        setCustomModel(r.model && !aliases.includes(r.model) ? r.model : '');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5 text-sm text-zinc-500">
        {error ?? 'Loading…'}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5 text-sm space-y-4">
      <p className="text-zinc-400 text-xs">
        Passed to <code className="text-zinc-300">claude -p</code> as{' '}
        <code className="text-zinc-300">--model</code> /{' '}
        <code className="text-zinc-300">--effort</code>. "Default" leaves the choice
        to the CLI. Changes apply from the next message — no session reset. Also
        available in chat via <code className="text-zinc-300">/model</code> and{' '}
        <code className="text-zinc-300">/effort</code>.
      </p>
      <div>
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1.5">Model</div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-zinc-700 overflow-hidden text-sm font-medium">
            {['default', ...aliases].map((m) => (
              <button
                key={m}
                onClick={() => apply({ model: m === 'default' ? '' : m })}
                disabled={busy}
                className={[
                  'px-3 py-1.5 transition-colors disabled:opacity-50',
                  (m === 'default' && model === null) || model === m
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800',
                ].join(' ')}
              >
                {m}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (customModel.trim()) apply({ model: customModel.trim() });
            }}
            className="flex gap-2"
          >
            <input
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder="full model id…"
              className="w-56 bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-600"
            />
            <button
              type="submit"
              disabled={busy || !customModel.trim() || customModel.trim() === model}
              className="px-3 py-1.5 border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 rounded text-xs disabled:opacity-50"
            >
              Use
            </button>
          </form>
        </div>
        {model && !aliases.includes(model) && (
          <p className="text-zinc-500 text-xs mt-1.5">
            Using custom model <code className="text-zinc-300">{model}</code>
          </p>
        )}
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1.5">Effort</div>
        <div className="inline-flex rounded-lg border border-zinc-700 overflow-hidden text-sm font-medium">
          {['default', ...efforts].map((l) => (
            <button
              key={l}
              onClick={() => apply({ effort: l === 'default' ? '' : l })}
              disabled={busy}
              className={[
                'px-3 py-1.5 transition-colors disabled:opacity-50',
                (l === 'default' && effort === null) || effort === l
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800',
              ].join(' ')}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}

const STEP_DELETE_LABELS: Record<number, string> = {
  0: 'Never',
  30: '30 sec',
  60: '1 min',
  300: '5 min',
  900: '15 min',
  1800: '30 min',
  3600: '1 hour',
  7200: '2 hours',
};

function StepDeleteCard() {
  const [seconds, setSeconds] = useState<number | null>(null);
  const [choices, setChoices] = useState<number[]>([0, 30, 60, 300, 900, 1800, 3600, 7200]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .stepDelete()
      .then((r) => {
        setSeconds(r.seconds);
        setChoices(r.choices);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoaded(true));
  }, []);

  const apply = async (s: number) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.setStepDelete(s);
      setSeconds(r.seconds);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5 text-sm text-zinc-500">
        {error ?? 'Loading…'}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5 text-sm space-y-3">
      <p className="text-zinc-400 text-xs">
        Intermediate progress messages streamed to Discord during a run (🧠 thinking,
        🛠 tool calls, ✅ results) are deleted after this delay to cut the noise. The
        final reply always stays. Applies to steps posted after the change.
      </p>
      <div className="inline-flex rounded-lg border border-zinc-700 overflow-hidden text-sm font-medium">
        {choices.map((s) => (
          <button
            key={s}
            onClick={() => apply(s)}
            disabled={busy}
            className={[
              'px-3 py-1.5 transition-colors disabled:opacity-50',
              seconds === s
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800',
            ].join(' ')}
          >
            {STEP_DELETE_LABELS[s] ?? `${s} sec`}
          </button>
        ))}
      </div>
      {seconds !== null && !choices.includes(seconds) && (
        <p className="text-zinc-500 text-xs">
          Using custom delay: {seconds} seconds.
        </p>
      )}
      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}

function FeedItem({ event }: { event: FeedEvent }) {
  const ts = new Date(event.created_at).toLocaleTimeString();

  if (event.etype === 'step') {
    if (event.kind === 'thinking') {
      return (
        <Row label="🧠 thinking" ts={ts} tone="muted">
          <span className="italic text-zinc-400">…</span>
        </Row>
      );
    }
    if (event.kind === 'tool_use') {
      return (
        <Row label={`🛠 ${event.tool_name ?? '?'}`} ts={ts} tone="tool">
          {event.tool_input && <Pre>{event.tool_input}</Pre>}
        </Row>
      );
    }
    // tool_result
    return (
      <Row label="✅ result" ts={ts} tone="result">
        {event.result_text && <Pre>{event.result_text}</Pre>}
      </Row>
    );
  }

  // message
  const isIn = event.direction === 'in';
  return (
    <Row
      label={isIn ? '→ Discord' : '← Agent'}
      ts={ts}
      tone={isIn ? 'in' : event.ok ? 'out' : 'error'}
      session={event.session_id}
    >
      <div className="whitespace-pre-wrap break-words text-zinc-100">
        {event.error ? (
          <span className="text-red-300">{event.error}</span>
        ) : (
          truncate(event.text, 600)
        )}
      </div>
    </Row>
  );
}

const TONES: Record<string, string> = {
  in: 'border-zinc-800 bg-zinc-900/40',
  out: 'border-blue-900/40 bg-blue-950/20',
  error: 'border-red-900/40 bg-red-950/20',
  muted: 'border-zinc-800/60 bg-zinc-900/20',
  tool: 'border-amber-900/40 bg-amber-950/10',
  result: 'border-emerald-900/40 bg-emerald-950/10',
};

function Row({
  label,
  ts,
  tone,
  session,
  children,
}: {
  label: string;
  ts: string;
  tone: keyof typeof TONES | string;
  session?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className={['rounded border px-3 py-2 text-sm', TONES[tone] ?? TONES.in].join(' ')}>
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className="text-xs uppercase tracking-wide text-zinc-500">{label}</span>
        <span className="text-xs text-zinc-600">{ts}</span>
      </div>
      <div className="font-mono text-xs text-zinc-200">{children}</div>
      {session && (
        <div className="text-[10px] text-zinc-600 mt-1 font-mono">
          session {session.slice(0, 8)}
        </div>
      )}
    </div>
  );
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words text-zinc-300 mt-0.5">{children}</pre>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + `… (+${s.length - n} chars)`;
}
