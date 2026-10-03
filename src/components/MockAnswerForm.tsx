'use client';

import { useEffect, useRef, useState } from 'react';
import { ANSWER_REVEAL_DELAY_MS, AnswerReveal, type AnswerOutcome, type RevealPhase } from '@/components/AnswerReveal';

/**
 * MOCK_AI stand-in for the real recorder: a text box instead of a mic.
 * Shared by /play/[code] and /practice. Keyed by question identity from the
 * parent so a new question remounts it with fresh state. Owns the same
 * "Checking… -> You answered: … -> verdict" reveal as RealRecordingPanel,
 * via the shared AnswerReveal component.
 */
export function MockAnswerForm({ onSubmit }: { onSubmit: (text: string) => Promise<AnswerOutcome | null> }) {
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
