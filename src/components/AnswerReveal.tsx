'use client';

export type RevealPhase = 'checking' | 'transcript' | 'result';

export interface AnswerOutcome {
  transcript: string;
  points: number;
  recorded: boolean;
}

/** How long "You answered: …" stays up before the correct/wrong verdict shows. */
export const ANSWER_REVEAL_DELAY_MS = 2000;

/**
 * Shared post-press display for both the MOCK_AI text box and the real
 * recorder: once a recording is transcribed, show it back to the kid first
 * ("You answered …"), then after a beat reveal whether it was right and how
 * many points it earned.
 */
export function AnswerReveal({ phase, outcome }: { phase: RevealPhase; outcome: AnswerOutcome | null }) {
  if (phase === 'checking' || !outcome) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-[2rem] bg-sky-400 text-white">
        <span className="text-[clamp(1.25rem,4vw,2rem)] font-bold">Checking…</span>
      </div>
    );
  }

  if (phase === 'transcript') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-[2rem] bg-sky-500 p-4 text-center text-white shadow-xl">
        <span className="text-sm font-semibold uppercase tracking-wide opacity-80">You answered</span>
        <span className="text-[clamp(1.1rem,4vw,1.75rem)] font-bold">
          {outcome.transcript.trim() ? `"${outcome.transcript}"` : '(nothing heard)'}
        </span>
      </div>
    );
  }

  const bg = !outcome.recorded ? 'bg-neutral-400' : outcome.points > 0 ? 'bg-emerald-600' : 'bg-rose-600';
  const label = !outcome.recorded ? 'No answer — 0' : outcome.points > 0 ? `✅ +${outcome.points}` : `❌ ${outcome.points}`;
  return (
    <div className={`flex h-full w-full items-center justify-center rounded-[2rem] text-center text-white shadow-xl ${bg}`}>
      <span className="text-[clamp(1.25rem,4vw,2rem)] font-black">{label}</span>
    </div>
  );
}
