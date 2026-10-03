'use client';

import { useEffect, useRef, useState } from 'react';
import { AnswerRecorder } from '@/lib/audio/recorder';
import { RECORDING_DURATION_MS } from '@/lib/game/config';

type Phase = 'starting' | 'recording' | 'uploading' | 'error';

/**
 * Real-audio counterpart to the MOCK_AI text box: starts recording the
 * instant it mounts (the press that revealed it was itself the user
 * gesture), auto-stops at 5s or on tap, and uploads. Cancels the in-flight
 * recording on unmount (e.g. the question moved on) so the mic never stays
 * open longer than it should.
 */
export function RealRecordingPanel({ onUpload }: { onUpload: (blob: Blob, filename: string) => Promise<void> }) {
  const recorderRef = useRef<AnswerRecorder | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [remainingMs, setRemainingMs] = useState(RECORDING_DURATION_MS);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
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
      recorder.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- upload is stable for the lifetime of one answer (see its own definition)
  }, []);

  async function upload(result: { blob: Blob; filename: string } | null) {
    setPhase('uploading');
    if (!result) return; // nothing captured; the server's own deadline expiry scores this as 0
    await onUpload(result.blob, result.filename);
  }

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

  if (phase === 'error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-[2rem] bg-neutral-300 p-4 text-center dark:bg-neutral-700">
        <p className="font-bold">{errorMessage}</p>
      </div>
    );
  }

  if (phase === 'uploading') {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-[2rem] bg-sky-400 text-white">
        <span className="text-[clamp(1.25rem,4vw,2rem)] font-bold">Checking…</span>
      </div>
    );
  }

  const fraction = phase === 'recording' ? remainingMs / RECORDING_DURATION_MS : 1;
  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <button
      type="button"
      disabled={phase !== 'recording'}
      onPointerDown={(e) => {
        e.preventDefault();
        finish();
      }}
      className="relative flex h-full w-full select-none items-center justify-center rounded-[2rem] bg-rose-500 text-white shadow-xl [touch-action:manipulation]"
    >
      {phase === 'starting' ? (
        <span className="text-[clamp(1.1rem,3.5vw,1.75rem)] font-bold">Starting mic…</span>
      ) : (
        <>
          <RingProgress fraction={fraction} />
          <span className="z-10 text-[clamp(2.5rem,10vw,4.5rem)] font-black tabular-nums">{seconds}</span>
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
