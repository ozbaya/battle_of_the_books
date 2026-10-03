'use client';

export type AnswerButtonStatus = 'ready' | 'locked' | 'checking' | 'correct' | 'titleOnly' | 'wrong' | 'noAnswer';

export interface AnswerButtonProps {
  status: AnswerButtonStatus;
  lockedReason?: string;
  points?: number;
  onPress: () => void;
}

const STYLES: Record<AnswerButtonStatus, string> = {
  ready: 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-emerald-500/40 cursor-pointer',
  locked: 'bg-neutral-300 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300 cursor-not-allowed',
  checking: 'bg-sky-400 text-white cursor-not-allowed',
  correct: 'bg-emerald-600 text-white cursor-not-allowed',
  titleOnly: 'bg-emerald-600 text-white cursor-not-allowed',
  wrong: 'bg-rose-600 text-white cursor-not-allowed',
  noAnswer: 'bg-neutral-400 text-white cursor-not-allowed',
};

function content(props: AnswerButtonProps): React.ReactNode {
  switch (props.status) {
    case 'ready':
      return <span className="text-[clamp(1.5rem,6vw,3rem)] font-black tracking-wide">ANSWER</span>;
    case 'locked':
      return <span className="px-4 text-[clamp(0.9rem,3vw,1.5rem)] font-bold">{props.lockedReason ?? 'Please wait…'}</span>;
    case 'checking':
      return <span className="text-[clamp(1rem,3.5vw,1.75rem)] font-bold">Checking…</span>;
    case 'correct':
      return <span className="text-[clamp(1.1rem,3.5vw,1.75rem)] font-black">✅ +{props.points}</span>;
    case 'titleOnly':
      return <span className="text-[clamp(1.1rem,3.5vw,1.75rem)] font-black">✅ +{props.points}</span>;
    case 'wrong':
      return <span className="text-[clamp(1.1rem,3.5vw,1.75rem)] font-black">❌ {props.points}</span>;
    case 'noAnswer':
      return <span className="text-[clamp(1rem,3.5vw,1.75rem)] font-bold">No answer — 0</span>;
  }
}

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
      {content(props)}
    </button>
  );
}
