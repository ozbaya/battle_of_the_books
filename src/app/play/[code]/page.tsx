'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { AnswerButton, type AnswerButtonStatus } from '@/components/AnswerButton';
import { ANSWER_REVEAL_DELAY_MS, AnswerReveal, type AnswerOutcome, type RevealPhase } from '@/components/AnswerReveal';
import { Countdown } from '@/components/Countdown';
import { MicLevelMeter, useMicCheck } from '@/components/MicCheck';
import { RealRecordingPanel } from '@/components/RealRecordingPanel';
import { Scoreboard } from '@/components/Scoreboard';
import type { PublicGameState } from '@/lib/game/engine';
import { useClientValue } from '@/lib/hooks/useClientValue';
import { serverAlignedNow, useGameState } from '@/lib/hooks/useGameState';

function playerIdKey(code: string): string {
  return `botb:${code}:playerId`;
}

interface MyStatus {
  status: AnswerButtonStatus;
  lockedReason?: string;
  showAnswerInput: boolean;
}

/**
 * Once a kid has pressed (or a press is optimistically in flight), the
 * input component owns the rest of this question's UI itself — recording
 * or typing, then "Checking…", then "You answered: …", then the verdict —
 * so AnswerButton only ever needs to represent the pre-press ready/locked
 * states.
 */
function computeMyStatus(state: PublicGameState, playerId: string, now: number, optimisticPending: boolean): MyStatus {
  const { phase } = state;

  if (phase.name === 'ROBOT_ANSWERING') {
    return { status: 'locked', lockedReason: 'The robots are answering…', showAnswerInput: false };
  }

  if (phase.name !== 'KIDS_ROUND') {
    return { status: 'locked', lockedReason: 'Wait for the next question…', showAnswerInput: false };
  }

  if (phase.answers[playerId] || optimisticPending) {
    return { status: 'locked', showAnswerInput: true };
  }

  const canPress = !phase.firstRespondent || (phase.buttonsCloseAt !== undefined && now < phase.buttonsCloseAt);
  if (canPress) {
    return { status: 'ready', showAnswerInput: false };
  }
  return { status: 'locked', lockedReason: 'Wait for the next question…', showAnswerInput: false };
}

export default function PlayPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const storedPlayerId = useClientValue(() => localStorage.getItem(playerIdKey(code)), null);
  const [joinedPlayerId, setJoinedPlayerId] = useState<string | null>(null);
  const { state, clockOffset, error } = useGameState(code);
  const playerId = joinedPlayerId ?? storedPlayerId;

  if (!playerId) return <JoinForm code={code} mockAi={state?.mockAi ?? true} onJoined={setJoinedPlayerId} />;
  if (error) return <CenteredMessage>Couldn&apos;t reach the game: {error}</CenteredMessage>;
  if (!state) return <CenteredMessage>Loading…</CenteredMessage>;

  return <PlayingView code={code} playerId={playerId} state={state} clockOffset={clockOffset} />;
}

function JoinForm({ code, mockAi, onJoined }: { code: string; mockAi: boolean; onJoined: (playerId: string) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mic = useMicCheck();

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // Both the join call and the mic permission prompt stem from this same
      // tap (a user gesture, required by iOS Safari) — run them together.
      const [res] = await Promise.all([
        fetch(`/api/games/${code}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        }),
        mockAi ? Promise.resolve() : mic.run(),
      ]);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Could not join');
        return;
      }
      localStorage.setItem(playerIdKey(code), body.playerId);
      onJoined(body.playerId);
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-neutral-50 p-6 dark:bg-neutral-950">
      <h1 className="text-3xl font-black">Join game {code}</h1>
      <form onSubmit={join} className="flex w-full max-w-xs flex-col gap-3">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={30}
          className="rounded-xl border border-neutral-300 px-4 py-3 text-lg dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded-xl bg-emerald-500 px-4 py-3 text-lg font-bold text-white disabled:opacity-50"
        >
          {busy ? 'Joining…' : 'Join'}
        </button>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {!mockAi && mic.status === 'checking' && (
          <div className="flex flex-col gap-1">
            <p className="text-sm opacity-70">Say something to test your mic…</p>
            <MicLevelMeter level={mic.level} />
          </div>
        )}
        {!mockAi && mic.status === 'error' && <p className="text-sm text-amber-600">{mic.error?.message}</p>}
      </form>
    </main>
  );
}

function PlayingView({
  code,
  playerId,
  state,
  clockOffset,
}: {
  code: string;
  playerId: string;
  state: PublicGameState;
  clockOffset: number;
}) {
  // Tracks which question a press was optimistically sent for, so it's
  // irrelevant (not a manual reset) as soon as the next question starts.
  const [pendingQuestionIndex, setPendingQuestionIndex] = useState<number | null>(null);
  const me = state.players[playerId];
  const pending = pendingQuestionIndex === state.currentIndex;

  const press = useCallback(async () => {
    setPendingQuestionIndex(state.currentIndex);
    try {
      const res = await fetch(`/api/games/${code}/press`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId }),
      });
      const body = await res.json();
      if (!body.accepted) setPendingQuestionIndex(null);
    } catch {
      setPendingQuestionIndex(null);
    }
  }, [code, playerId, state.currentIndex]);

  // Space/Enter presses on mouse devices; ignore key auto-repeat. Note the
  // ANSWER button auto-focuses itself (see AnswerButton), so excluding a
  // focused BUTTON here would block the very button this is meant to
  // activate — only text-entry targets are excluded.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat) return;
      if (e.code !== 'Space' && e.code !== 'Enter') return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      const status = computeMyStatus(state, playerId, serverAlignedNow(clockOffset), pending);
      if (status.status === 'ready') {
        e.preventDefault();
        press();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state, playerId, clockOffset, pending, press]);

  function extractOutcome(body: PublicGameState | null, questionIndex: number): AnswerOutcome | null {
    const entry = body?.history.find((r) => r.by === playerId && r.questionIndex === questionIndex);
    if (!entry) return null;
    return { transcript: entry.transcript, points: entry.points, recorded: entry.recorded };
  }

  async function submitMockAnswer(text: string): Promise<AnswerOutcome | null> {
    const questionIndex = state.currentIndex;
    const res = await fetch(`/api/games/${code}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, text }),
    });
    const body = await res.json().catch(() => null);
    return extractOutcome(body, questionIndex);
  }

  async function submitRealAnswer(blob: Blob, filename: string): Promise<AnswerOutcome | null> {
    const questionIndex = state.currentIndex;
    const form = new FormData();
    form.append('playerId', playerId);
    form.append('audio', blob, filename);
    const res = await fetch(`/api/games/${code}/answer`, { method: 'POST', body: form });
    const body = await res.json().catch(() => null);
    return extractOutcome(body, questionIndex);
  }

  if (state.phase.name === 'GAME_OVER') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-neutral-50 p-6 text-center dark:bg-neutral-950">
        <h1 className="text-3xl font-black">Game over!</h1>
        <Scoreboard state={state} />
        {me && (
          <p className="text-lg">
            Your score: <span className="font-bold">{me.score}</span>
          </p>
        )}
        <a href={`/scores/${code}`} className="mt-2 text-sky-600 underline dark:text-sky-400">
          See full scores
        </a>
      </main>
    );
  }

  if (state.phase.name === 'LOBBY') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-neutral-50 p-6 text-center dark:bg-neutral-950">
        <h1 className="text-2xl font-black">You&apos;re in, {me?.name}!</h1>
        <p className="opacity-70">Waiting for the host to start the game…</p>
        <div className="flex flex-wrap justify-center gap-2">
          {Object.values(state.players).map((p) => (
            <span key={p.id} className="rounded-full bg-black/5 px-3 py-1 text-sm dark:bg-white/10">
              {p.name}
            </span>
          ))}
        </div>
      </main>
    );
  }

  if (state.phase.name === 'GET_READY') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-neutral-50 p-6 text-center dark:bg-neutral-950">
        <h1 className="text-[clamp(1.5rem,8vw,3rem)] font-black">Get ready!</h1>
        <div className="text-[clamp(2rem,12vw,5rem)] font-black tabular-nums">
          <Countdown targetMs={state.phase.opensAt} clockOffset={clockOffset} />
        </div>
      </main>
    );
  }

  if (state.phase.name === 'REVEAL') {
    const mine = state.history.find((r) => r.questionIndex === state.currentIndex && r.by === playerId);
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-neutral-50 p-6 text-center dark:bg-neutral-950">
        {state.correctAnswer && (
          <p className="text-[clamp(1.1rem,4vw,1.75rem)] font-bold">
            {state.correctAnswer.title} by {state.correctAnswer.author}
          </p>
        )}
        {mine && <p className="text-lg">You got {mine.points > 0 ? `+${mine.points}` : mine.points} points</p>}
        <p className="opacity-70">
          Next question in <Countdown targetMs={state.phase.nextAt} clockOffset={clockOffset} />
        </p>
        <Scoreboard state={state} />
      </main>
    );
  }

  // KIDS_ROUND or ROBOT_ANSWERING
  const now = serverAlignedNow(clockOffset);
  const my = computeMyStatus(state, playerId, now, pending);

  return (
    <main className="flex h-dvh flex-col gap-3 overflow-hidden bg-neutral-50 p-3 pb-[env(safe-area-inset-bottom)] landscape:flex-row dark:bg-neutral-950">
      <PortraitRotateHint />
      <div className="flex min-h-0 flex-[1.1] items-stretch justify-center landscape:short:p-1">
        {my.showAnswerInput ? (
          state.mockAi ? (
            <MockAnswerForm key={state.currentIndex} onSubmit={submitMockAnswer} />
          ) : (
            <RealRecordingPanel key={state.currentIndex} onUpload={submitRealAnswer} />
          )
        ) : (
          <AnswerButton status={my.status} lockedReason={my.lockedReason} onPress={press} />
        )}
      </div>
      <div className="flex flex-[0.9] flex-col justify-between gap-2 short:gap-1">
        <p className="text-center text-[clamp(1rem,3.2vw,1.4rem)] font-bold leading-tight short:text-base">
          {state.questionText}
        </p>
        <Scoreboard state={state} compact />
        {me && (
          <p className="text-center text-sm opacity-70">
            {me.name}: {me.score} pts
          </p>
        )}
      </div>
    </main>
  );
}

/**
 * MOCK_AI stand-in for the real recorder (Milestone 6). Keyed by question
 * index from the parent so a new question remounts it with fresh state.
 * Owns the same "Checking… -> You answered: … -> verdict" reveal as
 * RealRecordingPanel, via the shared AnswerReveal component.
 */
function MockAnswerForm({ onSubmit }: { onSubmit: (text: string) => Promise<AnswerOutcome | null> }) {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'input' | RevealPhase>('input');
  const [outcome, setOutcome] = useState<AnswerOutcome | null>(null);
  const unmountedRef = useRef(false);
  useEffect(() => {
    // Reset on every setup: React Strict Mode's dev-only double effect
    // invoke runs setup -> cleanup -> setup again on the same instance, and
    // without this the first cleanup's unmountedRef.current = true would
    // wrongly stick forever (see the identical fix in RealRecordingPanel).
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPhase('checking');
    const result = await onSubmit(text);
    if (unmountedRef.current) return;
    setOutcome(result ?? { transcript: text, points: 0, recorded: false });
    setPhase('transcript');
    setTimeout(() => {
      if (!unmountedRef.current) setPhase('result');
    }, ANSWER_REVEAL_DELAY_MS);
  }

  if (phase !== 'input') {
    return <AnswerReveal phase={phase} outcome={outcome} />;
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col justify-center gap-2 rounded-2xl bg-sky-50 p-4 dark:bg-sky-950">
      <label className="text-sm font-semibold opacity-70">Type what you&apos;d say out loud:</label>
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Book title and author…"
        className="rounded-lg border border-neutral-300 px-3 py-2 text-lg dark:border-neutral-700 dark:bg-neutral-900"
      />
      <button type="submit" className="rounded-lg bg-sky-500 px-4 py-2 font-bold text-white">
        Submit answer
      </button>
    </form>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh items-center justify-center bg-neutral-50 p-6 text-center dark:bg-neutral-950">{children}</main>;
}

/** Friendly nudge on phones/tablets in portrait — portrait still works, this is just a hint (CLAUDE.md §8). */
function PortraitRotateHint() {
  return (
    <div className="hidden touch:portrait:flex items-center justify-center gap-2 rounded-xl bg-amber-100 px-3 py-1.5 text-center text-sm font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
      <span aria-hidden>📱↻</span> Turn your phone sideways for the best view
    </div>
  );
}
