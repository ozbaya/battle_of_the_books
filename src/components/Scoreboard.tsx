import type { PublicGameState } from '@/lib/game/engine';

export function Scoreboard({ state, compact = false }: { state: PublicGameState; compact?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl bg-black/5 dark:bg-white/10 ${
        compact ? 'px-3 py-1.5' : 'px-5 py-3'
      }`}
    >
      <Side label={state.teamName} score={state.teamScore} compact={compact} />
      <div className={`font-bold opacity-40 ${compact ? 'text-sm' : 'text-xl'}`}>vs</div>
      <Side label="🤖 Team Robo" score={state.robotScore} compact={compact} />
    </div>
  );
}

function Side({ label, score, compact }: { label: string; score: number; compact: boolean }) {
  return (
    <div className="text-center">
      <div className={`uppercase tracking-wide opacity-70 ${compact ? 'text-[0.6rem]' : 'text-xs'}`}>{label}</div>
      <div className={`font-bold tabular-nums ${compact ? 'text-lg' : 'text-3xl'}`}>{score}</div>
    </div>
  );
}
