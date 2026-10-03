'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AnswerButton } from '@/components/AnswerButton';
import { ANSWER_REVEAL_DELAY_MS, type AnswerOutcome } from '@/components/AnswerReveal';
import { MicLevelMeter, useMicCheck } from '@/components/MicCheck';
import { MockAnswerForm } from '@/components/MockAnswerForm';
import { RealRecordingPanel } from '@/components/RealRecordingPanel';
import { SCORE } from '@/lib/game/config';

// Preview feature: a title<->author flashcard quiz, practice-mode-only (no
// team/robots). Deliberately mirrors src/app/practice/page.tsx's structure
// and UI almost exactly — same components, same flow, same "Show me the
// answer" give-up pattern — just against /api/quiz/* instead of
// /api/practice/*, and a single-field reveal instead of a title+author pair.

const ROUND_SIZE = 10;
const WRONG_ANSWER_REVEAL_MS = 3000;

interface QuizPromptMeta {
  index: number;
  prompt: string;
}

interface QuizAnswerResult extends AnswerOutcome {
  correctAnswer: string;
}

interface RoundResult {
  points: number;
}

type SessionPhase = 'start' | 'playing' | 'done';

function pickRound(pool: QuizPromptMeta[]): number[] {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(ROUND_SIZE, shuffled.length)).map((q) => q.index);
}

export default function QuizPage() {
  const [prompts, setPrompts] = useState<QuizPromptMeta[] | null>(null);
  const [mockAi, setMockAi] = useState(true);
  const [sessionPhase, setSessionPhase] = useState<SessionPhase>('start');
  const [order, setOrder] = useState<number[]>([]);
  const [position, setPosition] = useState(0);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [starting, setStarting] = useState(false);
  const mic = useMicCheck();

  useEffect(() => {
    fetch('/api/quiz/questions')
      .then((res) => res.json())
      .then((body) => {
        setPrompts(body.questions ?? []);
        setMockAi(Boolean(body.mockAi));
      })
      .catch(() => setPrompts([]));
  }, []);

  async function startRound() {
    if (!prompts || prompts.length === 0) return;
    setStarting(true);
    try {
      if (!mockAi) await mic.run();
      setOrder(pickRound(prompts));
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

  function next() {
    if (position + 1 >= order.length) {
      setSessionPhase('done');
    } else {
      setPosition((p) => p + 1);
    }
  }

  async function submitMock(questionIndex: number, text: string): Promise<QuizAnswerResult | null> {
    const res = await fetch('/api/quiz/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: questionIndex, text }),
    });
    const body = await res.json().catch(() => null);
    if (!body) return null;
    recordResult(body.points);
    return { transcript: body.transcript, points: body.points, recorded: body.recorded, correctAnswer: body.correctAnswer };
  }

  async function submitReal(questionIndex: number, blob: Blob, filename: string): Promise<QuizAnswerResult | null> {
    const form = new FormData();
    form.append('index', String(questionIndex));
    form.append('audio', blob, filename);
    const res = await fetch('/api/quiz/answer', { method: 'POST', body: form });
    const body = await res.json().catch(() => null);
    if (!body) return null;
    recordResult(body.points);
    return { transcript: body.transcript, points: body.points, recorded: body.recorded, correctAnswer: body.correctAnswer };
  }

  if (!prompts) {
    return <Centered>Loading…</Centered>;
  }

  if (sessionPhase === 'start') {
    return (
      <Centered>
        <h1 className="text-3xl font-black">🧠 Title &amp; Author Quiz</h1>
        <p className="max-w-sm opacity-70">
          {Math.min(ROUND_SIZE, prompts.length)} quick flashcards — name the author, or name the book — no team, no robots, just you.
        </p>
        <button
          onClick={startRound}
          disabled={starting || prompts.length === 0}
          className="rounded-xl bg-violet-500 px-6 py-3 text-lg font-bold text-white disabled:opacity-50"
        >
          {starting ? 'Getting ready…' : 'Start the quiz'}
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
    return <ResultsView results={results} onPlayAgain={startRound} />;
  }

  const questionIndex = order[position];
  const promptText = prompts.find((q) => q.index === questionIndex)?.prompt ?? '';

  return (
    <QuizQuestionView
      key={position}
      questionIndex={questionIndex}
      questionNumber={position + 1}
      totalQuestions={order.length}
      promptText={promptText}
      mockAi={mockAi}
      onSubmitMock={(text) => submitMock(questionIndex, text)}
      onSubmitReal={(blob, filename) => submitReal(questionIndex, blob, filename)}
      onNext={next}
      onFinish={() => setSessionPhase('done')}
      isLast={position + 1 >= order.length}
    />
  );
}

function QuizQuestionView({
  questionIndex,
  questionNumber,
  totalQuestions,
  promptText,
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
  promptText: string;
  mockAi: boolean;
  onSubmitMock: (text: string) => Promise<QuizAnswerResult | null>;
  onSubmitReal: (blob: Blob, filename: string) => Promise<QuizAnswerResult | null>;
  onNext: () => void;
  onFinish: () => void;
  isLast: boolean;
}) {
  const [tapped, setTapped] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [readyForNext, setReadyForNext] = useState(false);
  const [revealAnswer, setRevealAnswer] = useState<string | null>(null);

  async function handleShowAnswer() {
    setGaveUp(true);
    setReadyForNext(true);
    const res = await fetch(`/api/quiz/answer-key?index=${questionIndex}`);
    const body = await res.json().catch(() => null);
    if (body?.correctAnswer) {
      setRevealAnswer(body.correctAnswer);
    }
  }

  function handleOutcome(outcome: QuizAnswerResult | null) {
    const needsReveal = Boolean(outcome && outcome.points < SCORE.FULL);
    setTimeout(() => {
      if (needsReveal && outcome) {
        setRevealAnswer(outcome.correctAnswer);
        setTimeout(() => setReadyForNext(true), WRONG_ANSWER_REVEAL_MS);
      } else {
        setReadyForNext(true);
      }
    }, ANSWER_REVEAL_DELAY_MS);
  }

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
      <p className="text-center text-[clamp(1.1rem,3.5vw,1.6rem)] font-bold leading-tight">{promptText}</p>
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
        <p className="text-center text-[clamp(1rem,3vw,1.35rem)] font-bold text-violet-700 dark:text-violet-300">
          The answer was <span className="underline">{revealAnswer}</span>
        </p>
      )}
      <div className="flex justify-center gap-3">
        {readyForNext && (
          <button onClick={onNext} className="rounded-xl bg-violet-500 px-6 py-3 text-lg font-bold text-white">
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

function ResultsView({ results, onPlayAgain }: { results: RoundResult[]; onPlayAgain: () => void }) {
  const totalScore = results.reduce((sum, r) => sum + r.points, 0);
  const correct = results.filter((r) => r.points === SCORE.FULL).length;
  const wrong = results.filter((r) => r.points === SCORE.WRONG).length;
  const noAnswer = results.filter((r) => r.points === SCORE.NONE).length;

  return (
    <Centered>
      <h1 className="text-3xl font-black">🎉 Quiz complete!</h1>
      <p className="text-5xl font-black tabular-nums">{totalScore}</p>
      <p className="opacity-70">points</p>
      <dl className="grid w-full max-w-xs grid-cols-2 gap-x-4 gap-y-1 rounded-2xl bg-black/5 p-4 text-left dark:bg-white/5">
        <dt className="opacity-70">✅ Correct</dt>
        <dd className="text-right font-bold">{correct}</dd>
        <dt className="opacity-70">❌ Wrong</dt>
        <dd className="text-right font-bold">{wrong}</dd>
        <dt className="opacity-70">— No answer</dt>
        <dd className="text-right font-bold">{noAnswer}</dd>
      </dl>
      <button onClick={onPlayAgain} className="rounded-xl bg-violet-500 px-6 py-3 text-lg font-bold text-white">
        Quiz me again
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
