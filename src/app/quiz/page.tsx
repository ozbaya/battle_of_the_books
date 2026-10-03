'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { AnswerButton } from '@/components/AnswerButton';
import { ANSWER_REVEAL_DELAY_MS, type AnswerOutcome } from '@/components/AnswerReveal';
import { MicLevelMeter, useMicCheck } from '@/components/MicCheck';
import { MockAnswerForm } from '@/components/MockAnswerForm';
import { RealRecordingPanel } from '@/components/RealRecordingPanel';
import { useClientValue } from '@/lib/hooks/useClientValue';
import { SCORE } from '@/lib/game/config';
import type { QuestionSet } from '@/lib/questions';
import { SOLO_NAME_KEY } from '@/lib/soloName';

// Preview feature: a title<->author flashcard quiz, practice-mode-only (no
// team/robots). Deliberately mirrors src/app/practice/page.tsx's structure
// and UI almost exactly — same components, same flow, same "Show me the
// answer" give-up pattern — just against /api/quiz/* instead of
// /api/practice/*, and a single-field reveal instead of a title+author pair.

const ROUND_SIZE = 10;
const WRONG_ANSWER_REVEAL_MS = 3000;

// A random image that jumps around the page on a fully-correct or a wrong
// answer — purely for fun, quiz-mode-only. Each file keeps its real
// intrinsic size for next/image's aspect-ratio box; display size is
// constrained with className.
interface QuizImage {
  src: string;
  width: number;
  height: number;
  alt: string;
}

const CELEBRATION_IMAGES: QuizImage[] = [
  { src: '/quiz-celebrations/gangnam-style.png', width: 320, height: 319, alt: 'Gangnam Style dance' },
  { src: '/quiz-celebrations/67.png', width: 640, height: 640, alt: '67' },
  { src: '/quiz-celebrations/thumbs-up-gnome.png', width: 1024, height: 1024, alt: 'Thumbs up gnome' },
];
const WRONG_ANSWER_IMAGES: QuizImage[] = [
  { src: '/quiz-wrong-answers/giraffe.png', width: 236, height: 383, alt: 'Giraffe sticking its tongue out' },
  { src: '/quiz-wrong-answers/crying-cat.png', width: 588, height: 521, alt: 'Crying cat meme' },
  { src: '/quiz-wrong-answers/sad-owl.png', width: 462, height: 663, alt: 'Sad wet owlet' },
];
const CELEBRATION_DISPLAY_MS = 3000;
// Time for one leg of the jump (all the way up, or all the way down).
// Started at 0.4s/leg, then 0.6s/leg (50% slower), now 0.9s/leg (another 50%
// slower) — a full up+down cycle is 1.8s.
const JUMP_LEG_S = 0.9;

// A sad trumpet sting on a wrong answer, a fanfare on a correct one —
// purely for fun, quiz-mode-only. Unlike the game's synthesized tones
// (lib/sound.ts), these are real <audio> elements, and by the time a sound
// is due (ANSWER_REVEAL_DELAY_MS after the outcome resolves — itself after
// a transcribe/judge round trip for real audio) we're several async hops
// and seconds away from the tap that triggered it. Strict autoplay policies
// (notably iOS Safari) can block a *new* Audio().play() called that late,
// even though plenty of earlier taps happened on the page. So instead we
// create and "prime" these elements once, synchronously inside the very
// first tap of the session ("Start the quiz") — playing + immediately
// pausing them registers the gesture against these specific elements —
// and just replay the same already-unlocked elements every time after.
interface SoundBoard {
  fanfare: HTMLAudioElement;
  trumpet: HTMLAudioElement;
}

function primeSoundBoard(): SoundBoard {
  const fanfare = new Audio('/quiz-sounds/fanfare.mp3');
  const trumpet = new Audio('/quiz-sounds/sad-trumpet.mp3');
  for (const el of [fanfare, trumpet]) {
    el.play()
      .then(() => {
        el.pause();
        el.currentTime = 0;
      })
      .catch(() => {});
  }
  return { fanfare, trumpet };
}

function playSound(el: HTMLAudioElement | undefined) {
  if (!el) return;
  el.currentTime = 0;
  el.play().catch(() => {});
}

function randomImage(images: QuizImage[]): QuizImage {
  return images[Math.floor(Math.random() * images.length)];
}

// Per-leg horizontal travel range. Randomizing this *per leg* (instead of
// once per occurrence) meant each leg could swing up to 70vw sideways on
// top of the 50vh vertical jump — a much longer hypotenuse to cover in the
// same JUMP_LEG_S, which reads as "faster" even after slowing the timing
// down, because speed is distance/time and the distance went up too.
// Shrinking the range (not just the duration) is what actually fixes that.
function randomJumpX(): number {
  return Math.random() * 30 - 15; // -15vw..15vw
}

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
  const [hardPrompts, setHardPrompts] = useState<QuizPromptMeta[]>([]);
  const [hardAvailable, setHardAvailable] = useState(false);
  const [difficulty, setDifficulty] = useState<QuestionSet>('standard');
  const [mockAi, setMockAi] = useState(true);
  const [sessionPhase, setSessionPhase] = useState<SessionPhase>('start');
  const [order, setOrder] = useState<number[]>([]);
  const [position, setPosition] = useState(0);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [starting, setStarting] = useState(false);
  const mic = useMicCheck();
  const [sounds, setSounds] = useState<SoundBoard | null>(null);
  const activePool = difficulty === 'hard' ? hardPrompts : prompts;
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

  useEffect(() => {
    fetch('/api/quiz/questions')
      .then((res) => res.json())
      .then((body) => {
        setPrompts(body.questions ?? []);
        setMockAi(Boolean(body.mockAi));
        setHardAvailable(Boolean(body.hardAvailable));
        if (!body.hardAvailable) return;
        return fetch('/api/quiz/questions?set=hard')
          .then((res) => res.json())
          .then((hardBody) => setHardPrompts(hardBody.questions ?? []));
      })
      .catch(() => setPrompts([]));
  }, []);

  async function startRound() {
    if (!activePool || activePool.length === 0) return;
    // Prime both sound effects synchronously, inside this tap, before any
    // `await` — see primeSoundBoard()'s comment for why.
    if (!sounds) setSounds(primeSoundBoard());
    setStarting(true);
    try {
      if (!mockAi) await mic.run();
      setOrder(pickRound(activePool));
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

  // Fire-and-forget: /quiz keeps no server state of its own, so this is the
  // only record of a round ever happening, for the admin usage view. Never
  // awaited by a caller and never surfaces an error to the kid.
  function logRoundUsage(roundResults: RoundResult[]) {
    const correct = roundResults.filter((r) => r.points === SCORE.FULL).length;
    const wrong = roundResults.filter((r) => r.points === SCORE.WRONG).length;
    const noAnswer = roundResults.filter((r) => r.points === SCORE.NONE).length;
    const score = roundResults.reduce((sum, r) => sum + r.points, 0);
    fetch('/api/usage/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'quiz', name, totalQuestions: order.length, correct, titleOnly: 0, wrong, noAnswer, score }),
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

  async function submitMock(questionIndex: number, text: string): Promise<QuizAnswerResult | null> {
    const res = await fetch('/api/quiz/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: questionIndex, text, set: difficulty }),
    });
    const body = await res.json().catch(() => null);
    if (!body) return null;
    recordResult(body.points);
    return { transcript: body.transcript, points: body.points, recorded: body.recorded, correctAnswer: body.correctAnswer };
  }

  async function submitReal(questionIndex: number, blob: Blob, filename: string): Promise<QuizAnswerResult | null> {
    const form = new FormData();
    form.append('index', String(questionIndex));
    form.append('set', difficulty);
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
          {Math.min(ROUND_SIZE, activePool?.length ?? 0)} quick flashcards — name the author, or name the book — no team, no robots, just you.
        </p>
        {hardAvailable && (
          <div className="flex gap-2">
            <button
              onClick={() => setDifficulty('standard')}
              className={`rounded-lg px-4 py-2 font-bold ${
                difficulty === 'standard'
                  ? 'bg-violet-500 text-white'
                  : 'border border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300'
              }`}
            >
              Normal
            </button>
            <button
              onClick={() => setDifficulty('hard')}
              className={`rounded-lg px-4 py-2 font-bold ${
                difficulty === 'hard'
                  ? 'bg-rose-500 text-white'
                  : 'border border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300'
              }`}
            >
              Hard 🔥
            </button>
          </div>
        )}
        <input
          value={name}
          onChange={(e) => updateName(e.target.value)}
          placeholder="Your name (optional)"
          className="w-full max-w-xs rounded-xl border border-neutral-300 px-4 py-2 text-center dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          onClick={startRound}
          disabled={starting || !activePool || activePool.length === 0}
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
  const promptText = activePool?.find((q) => q.index === questionIndex)?.prompt ?? '';

  return (
    <QuizQuestionView
      key={position}
      questionIndex={questionIndex}
      difficulty={difficulty}
      questionNumber={position + 1}
      totalQuestions={order.length}
      promptText={promptText}
      mockAi={mockAi}
      sounds={sounds}
      onSubmitMock={(text) => submitMock(questionIndex, text)}
      onSubmitReal={(blob, filename) => submitReal(questionIndex, blob, filename)}
      onNext={next}
      onFinish={finishRound}
      isLast={position + 1 >= order.length}
    />
  );
}

function QuizQuestionView({
  questionIndex,
  difficulty,
  questionNumber,
  totalQuestions,
  promptText,
  mockAi,
  sounds,
  onSubmitMock,
  onSubmitReal,
  onNext,
  onFinish,
  isLast,
}: {
  questionIndex: number;
  difficulty: QuestionSet;
  questionNumber: number;
  totalQuestions: number;
  promptText: string;
  mockAi: boolean;
  sounds: SoundBoard | null;
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
  const [celebration, setCelebration] = useState<QuizImage | null>(null);
  const [wrongImage, setWrongImage] = useState<QuizImage | null>(null);

  async function handleShowAnswer() {
    setGaveUp(true);
    setReadyForNext(true);
    const res = await fetch(`/api/quiz/answer-key?index=${questionIndex}&set=${difficulty}`);
    const body = await res.json().catch(() => null);
    if (body?.correctAnswer) {
      setRevealAnswer(body.correctAnswer);
    }
  }

  function handleOutcome(outcome: QuizAnswerResult | null) {
    const correct = Boolean(outcome && outcome.points === SCORE.FULL);
    const needsReveal = Boolean(outcome && outcome.points < SCORE.FULL);
    setTimeout(() => {
      if (needsReveal && outcome) {
        setRevealAnswer(outcome.correctAnswer);
        if (outcome.points === SCORE.WRONG) {
          playSound(sounds?.trumpet);
          setWrongImage(randomImage(WRONG_ANSWER_IMAGES));
        }
        setTimeout(() => setReadyForNext(true), WRONG_ANSWER_REVEAL_MS);
      } else if (correct) {
        playSound(sounds?.fanfare);
        setCelebration(randomImage(CELEBRATION_IMAGES));
        setTimeout(() => setReadyForNext(true), CELEBRATION_DISPLAY_MS);
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
      {celebration && <JumpingImage image={celebration} bottomClearance="calc(5rem + env(safe-area-inset-bottom))" />}
      {wrongImage && (
        // Wrong answers also show the reveal text above the button row, so this
        // one needs extra bottom clearance to jump above *that*, not just the button.
        <JumpingImage image={wrongImage} bottomClearance="calc(9rem + env(safe-area-inset-bottom))" />
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

/**
 * A full-page, clipped overlay the image jumps around inside —
 * `bottomClearance` is how far up from the bottom of the screen the overlay
 * stops, so the jump never overlaps whatever's below it (the Next question
 * button for a correct answer; that button plus the reveal text for a
 * wrong one).
 *
 * The vertical motion alternates up/down every JUMP_LEG_S seconds; every
 * time it switches direction (each time it's about to go down, or about to
 * go up), a fresh random horizontal target is picked too, so the sideways
 * drift isn't just a fixed back-and-forth between two points.
 */
function JumpingImage({ image, bottomClearance }: { image: QuizImage; bottomClearance: string }) {
  const [pos, setPos] = useState(() => ({ x: randomJumpX(), y: 0 }));
  const goingDown = useRef(true);

  useEffect(() => {
    const id = setInterval(() => {
      goingDown.current = !goingDown.current;
      setPos({ x: randomJumpX(), y: goingDown.current ? 50 : 0 });
    }, JUMP_LEG_S * 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center overflow-hidden"
      style={{ bottom: bottomClearance }}
    >
      <Image
        src={image.src}
        alt={image.alt}
        width={image.width}
        height={image.height}
        unoptimized
        className="h-56 w-56 rounded-2xl object-cover shadow-xl sm:h-72 sm:w-72"
        style={{
          transition: `transform ${JUMP_LEG_S}s ease-in-out`,
          transform: `translate(${pos.x}vw, ${pos.y}vh)`,
        }}
      />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-neutral-50 p-6 text-center dark:bg-neutral-950">
      {children}
    </main>
  );
}
