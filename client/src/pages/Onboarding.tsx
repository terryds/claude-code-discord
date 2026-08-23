import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { api, type AgentCheck, type Status, type BotInfo } from '../api';
import { AgentAuth } from '../components/AgentAuth';

type Props = { status: Status; onChange: () => void };

const CLAUDE_DOCS = {
  label: 'Claude Code',
  cli: 'claude',
  href: 'https://docs.claude.com/en/docs/claude-code/overview',
};

export function Onboarding({ status, onChange }: Props) {
  const [, setLocation] = useLocation();

  const [agentCheck, setAgentCheck] = useState<AgentCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [authed, setAuthed] = useState(false);

  const [token, setToken] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [bot, setBot] = useState<BotInfo | null>(status.bot);
  const [inviteUrl, setInviteUrl] = useState<string | null>(status.invite_url ?? null);

  const [capturing, setCapturing] = useState(false);
  const [captured, setCaptured] = useState<{ id: string; username: string | null } | null>(
    status.owner_id ? { id: status.owner_id, username: status.owner_username } : null
  );
  const [captureError, setCaptureError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  // Decide which step to land on. Step 1 isn't done until the CLI is both
  // installed and authenticated.
  const agentOk = agentCheck?.installed === true;
  const step =
    !agentOk || !authed
      ? 1
      : !status.bot_token_set || !bot
        ? 2
        : !captured
          ? 3
          : 4;

  const runAgentCheck = async () => {
    setChecking(true);
    try {
      const r = await api.agentCheck();
      setAgentCheck(r);
    } catch (e) {
      setAgentCheck({
        installed: false,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    runAgentCheck();
  }, []);

  const saveToken = async () => {
    setTokenError(null);
    setSavingToken(true);
    try {
      const r = await api.saveToken(token.trim());
      setBot(r.bot);
      setInviteUrl(r.invite_url ?? null);
      setCaptured(null);
      onChange();
    } catch (e) {
      setTokenError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingToken(false);
    }
  };

  const startCapture = async () => {
    setCaptureError(null);
    try {
      await api.startCapture();
      setCapturing(true);
    } catch (e) {
      setCaptureError(e instanceof Error ? e.message : String(e));
    }
  };

  const cancelCapture = async () => {
    try {
      await api.cancelCapture();
    } catch {
      // ignore
    }
    setCapturing(false);
  };

  useEffect(() => {
    if (!capturing) return;
    let stopped = false;
    const tick = async () => {
      try {
        const r = await api.captured();
        if (r.user_id) {
          setCaptured({ id: r.user_id, username: r.username });
          setCapturing(false);
          onChange();
          return;
        }
      } catch {
        // keep polling
      }
      if (!stopped) {
        pollRef.current = window.setTimeout(tick, 1500);
      }
    };
    tick();
    return () => {
      stopped = true;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [capturing]);

  const finish = async () => {
    try {
      await api.setRelay(true);
    } catch {
      // dashboard will surface relay state
    }
    onChange();
    setLocation('/');
  };

  return (
    <div className="min-h-full max-w-2xl mx-auto px-6 py-12">
      <header className="mb-10">
        <h1 className="text-2xl font-semibold">Welcome to your Claude Code Discord coworker</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Relay messages from a Discord bot to Claude Code running on this
          machine.
        </p>
      </header>

      <ol className="space-y-6">
        <StepCard
          n={1}
          title="Authenticate Claude Code"
          active={step === 1}
          done={agentOk && authed}
        >
          {checking ? (
            <p className="text-zinc-400 text-sm">Checking…</p>
          ) : agentOk ? (
            <div className="text-sm space-y-4">
              <div className="space-y-1">
                <p className="text-emerald-400">Found {CLAUDE_DOCS.label}.</p>
                {agentCheck?.version && (
                  <p className="text-zinc-400">
                    Version: <code className="text-zinc-200">{agentCheck.version}</code>
                  </p>
                )}
                {agentCheck?.path && (
                  <p className="text-zinc-400">
                    Path: <code className="text-zinc-200">{agentCheck.path}</code>
                  </p>
                )}
              </div>
              <div className="border-t border-zinc-800 pt-4">
                <AgentAuth onAuthed={setAuthed} />
              </div>
            </div>
          ) : (
            <div className="text-sm space-y-3">
              <p className="text-red-400">
                The <code>{CLAUDE_DOCS.cli}</code> CLI was not found on PATH.
              </p>
              {agentCheck?.error && (
                <pre className="bg-zinc-900 text-zinc-400 text-xs p-3 rounded overflow-auto whitespace-pre-wrap">
                  {agentCheck.error}
                </pre>
              )}
              <p className="text-zinc-400">
                Install it from{' '}
                <a
                  className="underline text-zinc-200"
                  href={CLAUDE_DOCS.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  the {CLAUDE_DOCS.label} docs
                </a>
                , then re-check.
              </p>
              <button
                onClick={runAgentCheck}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-sm"
              >
                Re-check
              </button>
            </div>
          )}
        </StepCard>

        <StepCard
          n={2}
          title="Create your Discord bot"
          active={step === 2}
          done={Boolean(bot)}
          disabled={step < 2}
        >
          <ol className="text-zinc-400 text-sm mb-4 space-y-2 list-decimal list-inside">
            <li>
              Open the{' '}
              <a
                className="underline text-zinc-200"
                href="https://discord.com/developers/applications"
                target="_blank"
                rel="noreferrer"
              >
                Discord Developer Portal
              </a>{' '}
              and click <span className="text-zinc-200">New Application</span>. Give
              it the name you want your coworker to have — e.g.{' '}
              <span className="text-zinc-300">My Coworker</span> — and click{' '}
              <span className="text-zinc-200">Create</span>.
            </li>
            <li>
              In the left sidebar, open the <span className="text-zinc-200">Bot</span>{' '}
              tab. Under{' '}
              <span className="text-zinc-200">Privileged Gateway Intents</span>,
              toggle ON{' '}
              <span className="text-zinc-200">Message Content Intent</span> and{' '}
              <span className="text-zinc-200">Server Members Intent</span>, then
              Save.
              <div className="mt-1 text-amber-300/90 text-xs">
                Don't skip this — without Message Content Intent the bot connects
                but can't read anything you type (the #1 cause of a silently-deaf
                bot).
              </div>
            </li>
            <li>
              Still on the Bot tab, click{' '}
              <span className="text-zinc-200">Reset Token</span> and copy the token
              — it's shown only once. Paste it below.
            </li>
          </ol>
          <div className="flex gap-2">
            <input
              type="password"
              autoComplete="off"
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm font-mono"
              placeholder="paste your bot token here…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={step < 2 || savingToken}
            />
            <button
              onClick={saveToken}
              disabled={step < 2 || !token.trim() || savingToken}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-medium"
            >
              {savingToken ? 'Saving…' : 'Save'}
            </button>
          </div>
          {tokenError && <p className="text-red-400 text-sm mt-2">{tokenError}</p>}
          {bot && (
            <div className="text-sm mt-4 space-y-3">
              <p className="text-emerald-400">
                Connected as <span className="font-mono">@{bot.username}</span>
              </p>
              {inviteUrl && (
                <div className="p-3 bg-zinc-900/70 border border-zinc-800 rounded space-y-2">
                  <p className="text-zinc-300">
                    <span className="text-zinc-100 font-medium">
                      4. Invite the bot to your server:
                    </span>{' '}
                    open the link, pick your server, and click{' '}
                    <span className="text-zinc-200">Authorize</span>.
                  </p>
                  <div className="flex gap-2">
                    <a
                      href={inviteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 bg-[#5865F2] hover:bg-[#4752c4] rounded text-xs font-medium text-white"
                    >
                      Open invite link ↗
                    </a>
                    <button
                      onClick={() => navigator.clipboard?.writeText(inviteUrl)}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs"
                    >
                      Copy link
                    </button>
                  </div>
                  <p className="text-zinc-500 text-xs">
                    No server yet? Create one in Discord first (+ button →{' '}
                    Create My Own) — it can be just for you and the bot.
                  </p>
                </div>
              )}
            </div>
          )}
        </StepCard>

        <StepCard
          n={3}
          title="Say hi to your bot"
          active={step === 3}
          done={Boolean(captured)}
          disabled={step < 3}
        >
          {captured ? (
            <div className="text-sm space-y-1">
              <p className="text-emerald-400">
                Linked{captured.username ? <> to <span className="font-mono">@{captured.username}</span></> : ''}.
              </p>
              <p className="text-zinc-400">
                Your Discord user ID: <code className="text-zinc-200">{captured.id}</code>
              </p>
            </div>
          ) : capturing ? (
            <div className="text-sm space-y-3">
              <p className="text-zinc-300">
                In Discord, send any message in a channel of the server you just
                invited{' '}
                {bot ? <span className="font-mono text-zinc-100">@{bot.username}</span> : 'the bot'}{' '}
                to (or DM it directly). The first message links you as the owner.
              </p>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-2 text-zinc-400 text-sm">
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                  Waiting for a message…
                </span>
                <button
                  onClick={cancelCapture}
                  className="text-zinc-400 hover:text-zinc-200 text-sm underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="text-sm space-y-3">
              <p className="text-zinc-400">
                We'll capture your Discord user ID from the first message you send
                — you become the first allowed user (the owner).
              </p>
              <button
                onClick={startCapture}
                disabled={step < 3}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-medium"
              >
                Start listening
              </button>
            </div>
          )}
          {captureError && (
            <p className="text-red-400 text-sm mt-2">{captureError}</p>
          )}
        </StepCard>
      </ol>

      {step === 4 && (
        <div className="mt-8 p-6 bg-emerald-950/30 border border-emerald-900/60 rounded-lg flex items-center justify-between">
          <div>
            <h3 className="font-medium text-emerald-200">All set</h3>
            <p className="text-sm text-emerald-300/80 mt-0.5">
              You're linked and the relay is live — message your bot any time.
            </p>
          </div>
          <button
            onClick={finish}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-sm font-medium"
          >
            Go to dashboard
          </button>
        </div>
      )}
    </div>
  );
}

function StepCard({
  n,
  title,
  active,
  done,
  disabled,
  children,
}: {
  n: number;
  title: string;
  active?: boolean;
  done?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li
      className={[
        'rounded-lg border p-5 transition-colors',
        active
          ? 'border-blue-600/60 bg-blue-950/20'
          : done
            ? 'border-emerald-900/60 bg-emerald-950/10'
            : 'border-zinc-800 bg-zinc-900/30',
        disabled ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className="flex items-start gap-3 mb-3">
        <div
          className={[
            'w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0',
            done
              ? 'bg-emerald-600 text-white'
              : active
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-400',
          ].join(' ')}
        >
          {done ? '✓' : n}
        </div>
        <h2 className="font-medium pt-0.5">{title}</h2>
      </div>
      <div className="pl-10">{children}</div>
    </li>
  );
}
