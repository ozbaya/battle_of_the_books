'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AnswerButton } from '@/components/AnswerButton';
import { ANSWER_REVEAL_DELAY_MS, type AnswerOutcome } from '@/components/AnswerReveal';
import { MicLevelMeter, useMicCheck } from '@/components/MicCheck';
import { MockAnswerForm } from '@/components/MockAnswerForm';
import { RealRecordingPanel } from '@/components/RealRecordingPanel';
import { useClientValue } from '@/lib/hooks/useClientValue';
import { SCORE } from '@/lib/game/config';
import { SOLO_NAME_KEY } from '@/lib/soloName';

const ROUND_SIZE = 10;
// How long to hold the correct answer on screen when the kid didn't get full
// credit, so there's time to actually read and learn it before moving on.
const WRONG_ANSWER_REVEAL_MS = 3000;

interface QuestionMeta {
  index: number;
  question: string;
}

interface PracticeAnswerResult extends AnswerOutcome {
  correctTitle: string;
  correctAuthor: string;
}

interface RoundResult {
  points: number;
}

type SessionPhase = 'start' | 'playing' | 'done';

function pickRound(pool: QuestionMeta[]): number[] {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(ROUND_SIZE, shuffled.length)).map((q) => q.index);
}

export default function PracticePage() {
  const [questions, setQuestions] = useState<QuestionMeta[] | null>(null);
  const [mockAi, setMockAi] = useState(true);
  const [sessionPhase, setSessionPhase] = useState<SessionPhase>('start');
  const [order, setOrder] = useState<number[]>([]);
  const [position, setPosition] = useState(0);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [starting, setStarting] = useState(false);
  const mic = useMicCheck();
  const storedName = useClientValue(() => localStorage.getItem(SOLO_NAME_KEY) ?? '', '');
  // null = "untouched this session", so the field shows the hydrated stored
  // value without needing an effect to copy it into local state.
  const [typedName, setTypedName] = useState<string | null>(null);
  const name = typedName ?? storedName;

  function updateName(value: string) {
    setTypedName(value);
    try {
      localStorage.setItem(SOLO_NAME_KEY, value);
    } catch {
      // Private browsing etc. — the field still works for this session.
    }
  }

  // Fetched ahead of time (not gated behind the Start tap) so that by the
  // time the user taps "Start practicing", we already know mockAi and can
  // decide synchronously, within that same tap, whether to run the mic
  // check — matching JoinForm's pattern, since iOS requires getUserMedia to
  // stay close to the triggering user gesture.
  useEffect(() => {
    fetch('/api/practice/questions')
      .then((res) => res.json())
      .then((body) => {
        setQuestions(body.questions ?? []);
        setMockAi(Boolean(body.mockAi));
      })
      .catch(() => setQuestions([]));
  }, []);

  async function startRound() {
    if (!questions || questions.length === 0) return;
    setStarting(true);
    try {
      if (!mockAi) await mic.run();
      setOrder(pickRound(questions));
      setPosition(0);
      setResults([]);
      setSessionPhase('playing');
    } finally {
      setStarting(false);
    }
  }

  function recordResult(points: number) {
    setResults((prev) => [...prev, { points }]);
  }

  // Fire-and-forget: /practice keeps no server state of its own, so this is
  // the only record of a round ever happening, for the admin usage view.
  // Never awaited by a caller and never surfaces an error to the kid.
  function logRoundUsage(roundResults: RoundResult[]) {
    const correct = roundResults.filter((r) => r.points === SCORE.FULL).length;
    const titleOnly = roundResults.filter((r) => r.points === SCORE.TITLE_ONLY).length;
    const wrong = roundResults.filter((r) => r.points === SCORE.WRONG).length;
    const noAnswer = roundResults.filter((r) => r.points === SCORE.NONE).length;
    const score = roundResults.reduce((sum, r) => sum + r.points, 0);
    fetch('/api/usage/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'practice', name, totalQuestions: order.length, correct, titleOnly, wrong, noAnswer, score }),
    }).catch(() => {});
  }

  function finishRound() {
    setSessionPhase('done');
    logRoundUsage(results);
  }

  function next() {
    if (position + 1 >= order.length) {
      finishRound();
    } else {
      setPosition((p) => p + 1);
    }
  }

  async function submitMock(questionIndex: number, text: string): Promise<PracticeAnswerResult | null> {
    const res = await fetch('/api/practice/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: questionIndex, text }),
    });
    const body = await res.json().catch(() => null);
    if (!body) return null;
    recordResult(body.points);
    return {
      transcript: body.transcript,
      points: body.points,
      recorded: body.recorded,
      correctTitle: body.correctTitle,
      correctAuthor: body.correctAuthor,
    };
  }

  async function submitReal(questionIndex: number, blob: Blob, filename: string): Promise<PracticeAnswerResult | null> {
    const form = new FormData();
    form.append('index', String(questionIndex));
    form.append('audio', blob, filename);
    const res = await fetch('/api/practice/answer', { method: 'POST', body: form });
    const body = await res.json().catch(() => null);
    if (!body) return null;
    recordResult(body.points);
    return {
      transcript: body.transcript,
      points: body.points,
      recorded: body.recorded,
      correctTitle: body.correctTitle,
      correctAuthor: body.correctAuthor,
    };
  }

  if (!questions) {
    return <Centered>Loading…</Centered>;
  }

  if (sessionPhase === 'start') {
    return (
      <Centered>
        <h1 className="text-3xl font-black">🎯 Practice Mode</h1>
        <p className="max-w-sm opacity-70">
          Answer {Math.min(ROUND_SIZE, questions.length)} questions on your own — no team, no robots, just you.
        </p>
        <input
          value={name}
          onChange={(e) => updateName(e.target.value)}
          placeholder="Your name (optional)"
          className="w-full max-w-xs rounded-xl border border-neutral-300 px-4 py-2 text-center dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          onClick={startRound}
          disabled={starting || questions.length === 0}
          className="rounded-xl bg-sky-500 px-6 py-3 text-lg font-bold text-white disabled:opacity-50"
        >
          {starting ? 'Getting ready…' : 'Start practicing'}
        </button>
        {!mockAi && mic.status === 'checking' && (
          <div className="flex w-full max-w-xs flex-col gap-1">
            <p className="text-sm opacity-70">Say something to test your mic…</p>
            <MicLevelMeter level={mic.level} />
          </div>
        )}
        {!mockAi && mic.status === 'error' && <p className="text-sm text-amber-600">{mic.error?.message}</p>}
        <Link href="/" className="text-sm text-neutral-500 underline hover:text-neutral-700 dark:hover:text-neutral-300">
          Back home
        </Link>
      </Centered>
    );
  }

  if (sessionPhase === 'done') {
    return <ResultsView results={results} onPracticeAgain={startRound} />;
  }

  const questionIndex = order[position];
  const questionText = questions.find((q) => q.index === questionIndex)?.question ?? '';

  return (
    <PracticeQuestionView
      key={position}
      questionIndex={questionIndex}
      questionNumber={position + 1}
      totalQuestions={order.length}
      questionText={questionText}
      mockAi={mockAi}
      onSubmitMock={(text) => submitMock(questionIndex, text)}
      onSubmitReal={(blob, filename) => submitReal(questionIndex, blob, filename)}
      onNext={next}
      onFinish={finishRound}
      isLast={position + 1 >= order.length}
    />
  );
}

function PracticeQuestionView({
  questionIndex,
  questionNumber,
  totalQuestions,
  questionText,
  mockAi,
  onSubmitMock,
  onSubmitReal,
  onNext,
  onFinish,
  isLast,
}: {
  questionIndex: number;
  questionNumber: number;
  totalQuestions: number;
  questionText: string;
  mockAi: boolean;
  onSubmitMock: (text: string) => Promise<PracticeAnswerResult | null>;
  onSubmitReal: (blob: Blob, filename: string) => Promise<PracticeAnswerResult | null>;
  onNext: () => void;
  onFinish: () => void;
  isLast: boolean;
}) {
  const [tapped, setTapped] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [readyForNext, setReadyForNext] = useState(false);
  const [revealAnswer, setRevealAnswer] = useState<{ title: string; author: string } | null>(null);

  // "Show me the answer": a deliberate give-up, not an attempt — no score,
  // no transcribe/judge call, just a lookup. Disables the answer button
  // immediately so the player can't then try to answer after seeing it.
  async function handleShowAnswer() {
    setGaveUp(true);
    setReadyForNext(true);
    const res = await fetch(`/api/practice/answer-key?index=${questionIndex}`);
    const body = await res.json().catch(() => null);
    if (body?.correctTitle) {
      setRevealAnswer({ title: body.correctTitle, author: body.correctAuthor });
    }
  }

  // Mirrors AnswerReveal's own ANSWER_REVEAL_DELAY_MS so this fires at the
  // same moment the child component's own verdict (✅/❌) appears. When the
  // kid didn't get full credit, hold the correct answer on screen for a bit
  // longer before letting them move on, instead of jumping straight to
  // "Next question".
  function handleOutcome(outcome: PracticeAnswerResult | null) {
    const needsReveal = Boolean(outcome && outcome.points < SCORE.FULL);
    setTimeout(() => {
      if (needsReveal && outcome) {
        setRevealAnswer({ title: outcome.correctTitle, author: outcome.correctAuthor });
        setTimeout(() => setReadyForNext(true), WRONG_ANSWER_REVEAL_MS);
      } else {
        setReadyForNext(true);
      }
    }, ANSWER_REVEAL_DELAY_MS);
  }

  // Space/Enter presses on mouse devices, same as /play. AnswerButton
  // auto-focuses itself, so (as there) only text-entry targets are excluded.
  useEffect(() => {
    if (tapped || gaveUp) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat) return;
      if (e.code !== 'Space' && e.code !== 'Enter') return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      e.preventDefault();
      setTapped(true);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tapped, gaveUp]);

  async function handleMockSubmit(text: string) {
    const outcome = await onSubmitMock(text);
    handleOutcome(outcome);
    return outcome;
  }

  async function handleRealSubmit(blob: Blob, filename: string) {
    const outcome = await onSubmitReal(blob, filename);
    handleOutcome(outcome);
    return outcome;
  }

  return (
    <main className="flex h-dvh flex-col gap-4 bg-neutral-50 p-4 pb-[env(safe-area-inset-bottom)] dark:bg-neutral-950">
      <div className="flex items-center justify-between">
        <button
          onClick={onFinish}
          className="text-sm text-neutral-500 underline hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          Finish round
        </button>
        <p className="text-sm font-semibold opacity-60">
          Question {questionNumber} of {totalQuestions}
        </p>
        <span className="w-16" aria-hidden />
      </div>
      <p className="text-center text-[clamp(1.1rem,3.5vw,1.6rem)] font-bold leading-tight">{questionText}</p>
      <div className="flex min-h-0 flex-1 items-stretch justify-center">
        {gaveUp ? (
          <AnswerButton status="locked" lockedReason="Here's the answer!" onPress={() => {}} />
        ) : !tapped ? (
          <AnswerButton status="ready" onPress={() => setTapped(true)} />
        ) : mockAi ? (
          <MockAnswerForm onSubmit={handleMockSubmit} />
        ) : (
          <RealRecordingPanel onUpload={handleRealSubmit} onSettled={() => handleOutcome(null)} />
        )}
      </div>
      {revealAnswer && (
        <p className="text-center text-[clamp(1rem,3vw,1.35rem)] font-bold text-sky-700 dark:text-sky-300">
          The answer was <span className="underline">{revealAnswer.title}</span> by {revealAnswer.author}
        </p>
      )}
      <div className="flex justify-center gap-3">
        {readyForNext && (
          <button onClick={onNext} className="rounded-xl bg-sky-500 px-6 py-3 text-lg font-bold text-white">
            {isLast ? 'See my results →' : 'Next question →'}
          </button>
        )}
        {!tapped && !gaveUp && (
          <button
            onClick={handleShowAnswer}
            className="rounded-xl border border-neutral-300 px-6 py-3 text-lg font-bold text-neutral-600 hover:bg-black/5 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-white/5"
          >
            Show me the answer
          </button>
        )}
      </div>
    </main>
  );
}

function ResultsView({ results, onPracticeAgain }: { results: RoundResult[]; onPracticeAgain: () => void }) {
  const totalScore = results.reduce((sum, r) => sum + r.points, 0);
  const full = results.filter((r) => r.points === SCORE.FULL).length;
  const titleOnly = results.filter((r) => r.points === SCORE.TITLE_ONLY).length;
  const wrong = results.filter((r) => r.points === SCORE.WRONG).length;
  const noAnswer = results.filter((r) => r.points === SCORE.NONE).length;

  return (
    <Centered>
      <h1 className="text-3xl font-black">🎉 Round complete!</h1>
      <p className="text-5xl font-black tabular-nums">{totalScore}</p>
      <p className="opacity-70">points</p>
      <dl className="grid w-full max-w-xs grid-cols-2 gap-x-4 gap-y-1 rounded-2xl bg-black/5 p-4 text-left dark:bg-white/5">
        <dt className="opacity-70">✅ Book &amp; author</dt>
        <dd className="text-right font-bold">{full}</dd>
        <dt className="opacity-70">✅ Book only</dt>
        <dd className="text-right font-bold">{titleOnly}</dd>
        <dt className="opacity-70">❌ Wrong</dt>
        <dd className="text-right font-bold">{wrong}</dd>
        <dt className="opacity-70">— No answer</dt>
        <dd className="text-right font-bold">{noAnswer}</dd>
      </dl>
      <button onClick={onPracticeAgain} className="rounded-xl bg-sky-500 px-6 py-3 text-lg font-bold text-white">
        Practice again
      </button>
      <Link href="/" className="text-sm text-neutral-500 underline hover:text-neutral-700 dark:hover:text-neutral-300">
        Back home
      </Link>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-neutral-50 p-6 text-center dark:bg-neutral-950">
      {children}
    </main>
  );
}
