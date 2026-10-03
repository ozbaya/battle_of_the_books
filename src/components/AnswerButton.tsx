'use client';

export type AnswerButtonStatus = 'ready' | 'locked';

export interface AnswerButtonProps {
  status: AnswerButtonStatus;
  lockedReason?: string;
  onPress: () => void;
}

const STYLES: Record<AnswerButtonStatus, string> = {
  ready: 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-emerald-500/40 cursor-pointer',
  locked: 'bg-neutral-300 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300 cursor-not-allowed',
};

export function AnswerButton(props: AnswerButtonProps) {
  const isReady = props.status === 'ready';
  return (
    <button
      type="button"
      disabled={!isReady}
      onPointerDown={(e) => {
        if (!isReady) return;
        e.preventDefault();
        props.onPress();
      }}
      className={`flex h-full w-full select-none items-center justify-center rounded-[2rem] text-center shadow-xl transition-transform [touch-action:manipulation] ${
        isReady ? 'active:scale-95' : ''
      } ${STYLES[props.status]}`}
    >
      {isReady ? (
        <span className="text-[clamp(1.5rem,6vw,3rem)] font-black tracking-wide">ANSWER</span>
      ) : (
        <span className="px-4 text-[clamp(0.9rem,3vw,1.5rem)] font-bold">{props.lockedReason ?? 'Please wait…'}</span>
      )}
    </button>
  );
}
