'use client';

import { useEffect, useRef, useState } from 'react';
import { ANSWER_REVEAL_DELAY_MS, AnswerReveal, type AnswerOutcome, type RevealPhase } from '@/components/AnswerReveal';
import { AnswerRecorder } from '@/lib/audio/recorder';
import { RECORDING_DURATION_MS } from '@/lib/game/config';

type Phase = 'starting' | 'recording' | RevealPhase | 'error';

/**
 * Real-audio counterpart to the MOCK_AI text box: starts recording the
 * instant it mounts (the press that revealed it was itself the user
 * gesture), auto-stops at 5s or on tap, uploads, then — per the "show the
 * transcript, then the verdict" flow — holds on the transcript for a beat
 * before revealing whether it was right. Cancels the in-flight recording on
 * unmount (e.g. the question moved on) so the mic never stays open longer
 * than it should.
 */
export function RealRecordingPanel({
  onUpload,
}: {
  onUpload: (blob: Blob, filename: string) => Promise<AnswerOutcome | null>;
}) {
  const recorderRef = useRef<AnswerRecorder | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [remainingMs, setRemainingMs] = useState(RECORDING_DURATION_MS);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<AnswerOutcome | null>(null);

  useEffect(() => {
    // Reset on every setup, not just once: React Strict Mode's dev-only
    // double effect invoke runs setup -> cleanup -> setup again on the same
    // instance, and without this the cleanup's unmountedRef.current = true
    // would wrongly stick forever, silently dropping every future update.
    unmountedRef.current = false;
    const recorder = new AnswerRecorder();
    recorderRef.current = recorder;
    let cancelled = false;

    recorder
      .start(
        () => {
          if (cancelled) return;
          startedAtRef.current = Date.now();
          setPhase('recording');
        },
        (result) => {
          // Fires when the 5s hard limit elapses on its own (not from the
          // "Done" tap, which calls finish() directly below).
          if (cancelled) return;
          void upload(result);
        }
      )
      .then((result) => {
        if (cancelled || result.ok) return;
        setErrorMessage(result.error.message);
        setPhase('error');
      });

    return () => {
      cancelled = true;
      unmountedRef.current = true;
      recorder.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- upload/onUpload are stable for the lifetime of one answer
  }, []);

  async function upload(result: { blob: Blob; filename: string } | null) {
    setPhase('checking');
    let result2: AnswerOutcome | null = null;
    try {
      result2 = result ? await onUpload(result.blob, result.filename) : null;
    } catch (err) {
      if (unmountedRef.current) return;
      setErrorMessage(err instanceof Error ? err.message : 'Could not submit your answer. Please tell an adult.');
      setPhase('error');
      return;
    }
    if (unmountedRef.current) return;
    setOutcome(result2 ?? { transcript: '', points: 0, recorded: false });
    setPhase('transcript');
    setTimeout(() => {
      if (!unmountedRef.current) setPhase('result');
    }, ANSWER_REVEAL_DELAY_MS);
  }

  useEffect(() => {
    if (phase === 'recording') buttonRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const id = setInterval(() => {
      const startedAt = startedAtRef.current;
      if (startedAt === null) return;
      setRemainingMs(Math.max(0, RECORDING_DURATION_MS - (Date.now() - startedAt)));
    }, 100);
    return () => clearInterval(id);
  }, [phase]);

  async function finish() {
    const recorder = recorderRef.current;
    if (!recorder || phase !== 'recording') return;
    const result = await recorder.stop();
    await upload(result);
  }

  function cancel() {
    const recorder = recorderRef.current;
    if (!recorder || phase !== 'recording') return;
    recorder.cancel();
    // Deliberate cancel: no transcript to show, go straight to the verdict.
    setOutcome({ transcript: '', points: 0, recorded: false });
    setPhase('result');
  }

  // Esc cancels the recording on mouse devices (CLAUDE.md §8).
  useEffect(() => {
    if (phase !== 'recording') return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') cancel();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cancel reads refs/state via closures re-created each render; re-subscribing on phase change alone is correct here
  }, [phase]);

  if (phase === 'error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-[2rem] bg-neutral-300 p-4 text-center dark:bg-neutral-700">
        <p className="font-bold">{errorMessage}</p>
      </div>
    );
  }

  if (phase === 'checking' || phase === 'transcript' || phase === 'result') {
    return <AnswerReveal phase={phase} outcome={outcome} />;
  }

  const fraction = phase === 'recording' ? remainingMs / RECORDING_DURATION_MS : 1;
  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={phase !== 'recording'}
      onPointerDown={(e) => {
        e.preventDefault();
        finish();
      }}
      className="relative flex h-full min-h-[200px] w-full min-w-[200px] select-none items-center justify-center rounded-[2rem] bg-rose-500 text-white shadow-xl [touch-action:manipulation] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-300"
    >
      {phase === 'starting' ? (
        <span className="text-[clamp(1.1rem,3.5vw,1.75rem)] font-bold">Starting mic…</span>
      ) : (
        <>
          <RingProgress fraction={fraction} />
          <span className="z-10 text-[clamp(2.5rem,10vw,4.5rem)] font-black tabular-nums">{seconds}</span>
          <span className="absolute bottom-3 hidden text-xs font-medium opacity-80 mouse:block">Click to finish early · Esc to cancel</span>
        </>
      )}
    </button>
  );
}

function RingProgress({ fraction }: { fraction: number }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full animate-pulse p-2">
      <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="6" />
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        stroke="white"
        strokeWidth="6"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - fraction)}
        strokeLinecap="round"
        transform="rotate(-90 50 50)"
      />
    </svg>
  );
}
