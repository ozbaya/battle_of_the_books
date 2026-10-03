'use client';

import { useEffect, useState } from 'react';
import type { Difficulty } from '@/lib/game/types';
import { useGameState } from '@/lib/hooks/useGameState';

interface GameSummary {
  code: string;
  teamName: string;
  difficulty: Difficulty;
  phase: string;
  createdAt: number;
}

interface StoreDiagnostics {
  active: 'memory' | 'redis';
  redisEnvDetected: boolean;
  storeEnvOverride: string | undefined;
}

const BUCKETS = [
  { bucket: 'full', label: 'Full (+2)', points: 2 },
  { bucket: 'titleOnly', label: 'Title (+1)', points: 1 },
  { bucket: 'wrong', label: 'Wrong (−0.5)', points: -0.5 },
  { bucket: 'none', label: 'No answer (0)', points: 0 },
] as const;

export default function AdminPage() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [storeInfo, setStoreInfo] = useState<StoreDiagnostics | null>(null);
  const [selectedCode, setSelectedCode] = useState('');

  const refreshGames = async () => {
    const res = await fetch('/api/admin/games');
    if (res.status === 401) {
      setLoggedIn(false);
      return;
    }
    setLoggedIn(true);
    const body = await res.json();
    setGames(body.games ?? []);
    setStoreInfo(body.store ?? null);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/admin/games');
      if (cancelled) return;
      if (res.status === 401) {
        setLoggedIn(false);
        return;
      }
      setLoggedIn(true);
      const body = await res.json();
      if (!cancelled) {
        setGames(body.games ?? []);
        setStoreInfo(body.store ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loggedIn === null) return <Centered>Loading…</Centered>;
  if (!loggedIn) return <LoginForm onLoggedIn={refreshGames} />;

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 p-6">
      <h1 className="text-3xl font-black">Battle of the Books — Admin</h1>
      {storeInfo && <StoreBadge info={storeInfo} />}
      <CreateGameForm onCreated={(code) => { setSelectedCode(code); refreshGames(); }} />
      <RecentGames games={games} onSelect={setSelectedCode} onRefresh={refreshGames} />
      {selectedCode && <ManageGame code={selectedCode} />}
    </main>
  );
}

function StoreBadge({ info }: { info: StoreDiagnostics }) {
  if (info.active === 'redis') {
    return (
      <p className="rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
        ✅ Using Redis — game state is shared across server instances.
      </p>
    );
  }
  return (
    <div className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-200">
      <p className="font-bold">⚠️ Using the in-memory store, not Redis.</p>
      <p>
        On Vercel this means different requests can hit different server instances with different
        game state — exactly the &ldquo;Game not found&rdquo; symptom. Redis env vars detected:{' '}
        <strong>{info.redisEnvDetected ? 'yes' : 'no'}</strong>
        {info.storeEnvOverride && (
          <>
            {' '}
            · <code>STORE={info.storeEnvOverride}</code> is forcing memory mode
          </>
        )}
        .
      </p>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh items-center justify-center p-6">{children}</main>;
}

function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Login failed');
        return;
      }
      onLoggedIn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Centered>
      <form onSubmit={login} className="flex w-full max-w-xs flex-col gap-3">
        <h1 className="text-center text-2xl font-black">Admin login</h1>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Admin password"
          className="rounded-xl border border-neutral-300 px-4 py-3 text-lg dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button type="submit" disabled={busy} className="rounded-xl bg-emerald-500 px-4 py-3 font-bold text-white disabled:opacity-50">
          {busy ? 'Checking…' : 'Log in'}
        </button>
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </form>
    </Centered>
  );
}

function CreateGameForm({ onCreated }: { onCreated: (code: string) => void }) {
  const [teamName, setTeamName] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [numQuestions, setNumQuestions] = useState(10);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ code: string; links: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamName, difficulty, numQuestions }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Could not create game');
        return;
      }
      setResult(body);
      onCreated(body.code);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
      <h2 className="text-xl font-bold">Create a game</h2>
      <form onSubmit={create} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm opacity-70">Team name</span>
          <input
            required
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm opacity-70">Difficulty</span>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as Difficulty)}
            className="rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="easy">Easy (7s)</option>
            <option value="medium">Medium (5s)</option>
            <option value="hard">Hard (2s)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm opacity-70"># Questions</span>
          <input
            type="number"
            min={1}
            value={numQuestions}
            onChange={(e) => setNumQuestions(Number(e.target.value))}
            className="w-24 rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <button type="submit" disabled={busy} className="rounded-lg bg-emerald-500 px-4 py-2 font-bold text-white disabled:opacity-50">
          {busy ? 'Creating…' : 'Create game'}
        </button>
      </form>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {result && (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950">
          <p className="font-bold">Code: {result.code}</p>
          <ul className="list-inside list-disc">
            {Object.entries(result.links).map(([k, v]) => (
              <li key={k}>
                <a className="text-sky-600 underline dark:text-sky-400" href={v} target="_blank" rel="noreferrer">
                  {k}: {v}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function RecentGames({ games, onSelect, onRefresh }: { games: GameSummary[]; onSelect: (code: string) => void; onRefresh: () => void }) {
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Recent games</h2>
        <button onClick={onRefresh} className="text-sm text-sky-600 underline dark:text-sky-400">
          Refresh
        </button>
      </div>
      {games.length === 0 && <p className="opacity-60">No games yet.</p>}
      <ul className="flex flex-col gap-1">
        {games.map((g) => (
          <li key={g.code}>
            <button onClick={() => onSelect(g.code)} className="w-full rounded-lg px-3 py-2 text-left hover:bg-black/5 dark:hover:bg-white/5">
              <span className="font-mono font-bold">{g.code}</span> — {g.teamName} ({g.difficulty}) — {g.phase}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ManageGame({ code }: { code: string }) {
  const { state, error } = useGameState(code);
  const [busy, setBusy] = useState(false);

  async function action(body: object) {
    setBusy(true);
    try {
      await fetch(`/api/admin/games/${code}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
      <h2 className="text-xl font-bold">Manage {code}</h2>
      {error && <p className="text-rose-600">{error}</p>}
      {!state && !error && <p className="opacity-60">Loading…</p>}
      {state && (
        <>
          <p className="opacity-70">
            Phase: <span className="font-mono">{state.phase.name}</span> — Team {state.teamScore} / Robots {state.robotScore}
          </p>
          <div className="flex gap-2">
            <button
              disabled={busy || state.phase.name !== 'LOBBY'}
              onClick={() => action({ action: 'start' })}
              className="rounded-lg bg-emerald-500 px-4 py-2 font-bold text-white disabled:opacity-40"
            >
              Start game
            </button>
            <button
              disabled={busy || state.phase.name === 'GAME_OVER'}
              onClick={() => action({ action: 'end' })}
              className="rounded-lg bg-rose-500 px-4 py-2 font-bold text-white disabled:opacity-40"
            >
              End game
            </button>
          </div>
          <h3 className="mt-2 font-bold">Answers</h3>
          <ul className="flex flex-col gap-2">
            {state.history.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-sm dark:bg-white/5">
                <span className="font-semibold">
                  Q{r.questionIndex + 1} — {r.by === 'robots' ? '🤖 Team Robo' : state.players[r.by]?.name ?? r.by}
                </span>
                <span className="italic opacity-70">&ldquo;{r.transcript}&rdquo;</span>
                <span className="font-bold">{r.points > 0 ? `+${r.points}` : r.points}</span>
                {r.needsReview && <span className="rounded bg-amber-300 px-1 text-amber-900">needs review</span>}
                <span className="flex gap-1">
                  {BUCKETS.map((b) => {
                    const isCurrent = r.points === b.points;
                    return (
                      <button
                        key={b.bucket}
                        disabled={busy}
                        onClick={() => action({ action: 'override', historyIndex: i, bucket: b.bucket })}
                        className={`rounded border px-2 py-0.5 text-xs ${
                          isCurrent
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : 'border-neutral-300 hover:bg-black/10 dark:border-neutral-700 dark:hover:bg-white/10'
                        }`}
                      >
                        {b.label}
                      </button>
                    );
                  })}
                </span>
              </li>
            ))}
            {state.history.length === 0 && <p className="opacity-60">No answers yet.</p>}
          </ul>
        </>
      )}
    </section>
  );
}
