'use client';

import { useEffect, useRef } from 'react';

export type AnswerButtonStatus = 'ready' | 'locked';

export interface AnswerButtonProps {
  status: AnswerButtonStatus;
  lockedReason?: string;
  onPress: () => void;
}

const STYLES: Record<AnswerButtonStatus, string> = {
  ready:
    'bg-emerald-500 hover:bg-emerald-400 text-white shadow-emerald-500/40 cursor-pointer focus-visible:ring-4 focus-visible:ring-emerald-300 focus-visible:outline-none',
  locked: 'bg-neutral-300 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300 cursor-not-allowed',
};

export function AnswerButton(props: AnswerButtonProps) {
  const isReady = props.status === 'ready';
  const ref = useRef<HTMLButtonElement>(null);

  // Laptops: keyboard focus starts on the answer button once it's live, so
  // Space/Enter works without a click first (CLAUDE.md §8).
  useEffect(() => {
    if (isReady) ref.current?.focus();
  }, [isReady]);

  return (
    <button
      ref={ref}
      type="button"
      disabled={!isReady}
      onPointerDown={(e) => {
        if (!isReady) return;
        e.preventDefault();
        props.onPress();
      }}
      className={`relative flex h-full min-h-[200px] w-full min-w-[200px] select-none items-center justify-center rounded-[2rem] text-center shadow-xl transition-transform [touch-action:manipulation] ${
        isReady ? 'active:scale-95' : ''
      } ${STYLES[props.status]}`}
    >
      {isReady ? (
        <>
          <span className="text-[clamp(1.5rem,6vw,3rem)] font-black tracking-wide">ANSWER</span>
          <span className="absolute bottom-3 hidden text-xs font-medium opacity-80 mouse:block">Press Space to answer</span>
        </>
      ) : (
        <span className="px-4 text-[clamp(0.9rem,3vw,1.5rem)] font-bold">{props.lockedReason ?? 'Please wait…'}</span>
      )}
    </button>
  );
}
