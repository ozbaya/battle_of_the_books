'use client';

import { use } from 'react';
import { JoinQR } from '@/components/JoinQR';
import { Scoreboard } from '@/components/Scoreboard';
import { SoundToggle } from '@/components/SoundToggle';
import { StatusBanner } from '@/components/StatusBanner';
import { useClientValue } from '@/lib/hooks/useClientValue';
import { useGameSounds } from '@/lib/hooks/useGameSounds';
import { useGameState } from '@/lib/hooks/useGameState';

function chipForAnswer(status: string, points: number | undefined): string {
  if (status !== 'done') return '🎙️…';
  if (points === undefined) return '…';
  if (points >= 2) return `✅ +${points}`;
  if (points > 0) return `✅ +${points}`;
  if (points < 0) return `❌ ${points}`;
  return '— 0';
}

export default function ScreenPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { state, clockOffset, error } = useGameState(code);
  const joinUrl = useClientValue(() => `${window.location.origin}/play/${code}`, '');
  useGameSounds(state);

  if (error) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-neutral-950 text-white">
        <p className="text-2xl">Couldn&apos;t reach the game: {error}</p>
      </main>
    );
  }
  if (!state) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-neutral-950 text-white">
        <p className="text-2xl">Loading…</p>
      </main>
    );
  }

  if (state.phase.name === 'LOBBY') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-neutral-950 p-8 text-center text-white">
        <SoundToggle />
        <h1 className="text-[clamp(2rem,6vw,4rem)] font-black">Join at {joinUrl.replace(/^https?:\/\//, '')}</h1>
        <p className="text-[clamp(2.5rem,10vw,6rem)] font-black tracking-widest text-emerald-400">{code}</p>
        {joinUrl && <JoinQR url={joinUrl} size={220} />}
        <div className="flex flex-wrap justify-center gap-3">
          {Object.values(state.players).length === 0 && <p className="opacity-60">Waiting for players…</p>}
          {Object.values(state.players).map((p) => (
            <span key={p.id} className="rounded-full bg-white/10 px-4 py-2 text-xl">
              {p.name}
            </span>
          ))}
        </div>
      </main>
    );
  }

  const kidAnswers = state.phase.name === 'KIDS_ROUND' ? state.phase.answers : {};

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-neutral-950 p-8 text-white">
      <SoundToggle />
      <h1 className="text-center text-[clamp(1.75rem,5vw,3.5rem)] font-black leading-tight">{state.questionText}</h1>
      <div className="w-full max-w-3xl">
        <StatusBanner state={state} clockOffset={clockOffset} />
      </div>
      {Object.keys(kidAnswers).length > 0 && (
        <div className="flex flex-wrap justify-center gap-3">
          {Object.values(kidAnswers).map((a) => (
            <span key={a.playerId} className="rounded-full bg-white/10 px-4 py-2 text-lg">
              {state.players[a.playerId]?.name ?? '?'}: {chipForAnswer(a.status, a.points)}
            </span>
          ))}
        </div>
      )}
      <Scoreboard state={state} />
    </main>
  );
}
