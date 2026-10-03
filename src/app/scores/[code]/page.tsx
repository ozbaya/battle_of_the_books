'use client';

import { use } from 'react';
import Link from 'next/link';
import { Scoreboard } from '@/components/Scoreboard';
import { useGameState } from '@/lib/hooks/useGameState';

export default function ScoresPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { state, error } = useGameState(code);

  if (error) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-neutral-950 text-white">
        <p className="text-xl">Couldn&apos;t reach the game: {error}</p>
      </main>
    );
  }
  if (!state) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-neutral-950 text-white">
        <p className="text-xl">Loading…</p>
      </main>
    );
  }

  const players = Object.values(state.players).sort((a, b) => b.score - a.score);

  return (
    <main className="flex min-h-dvh flex-col items-center gap-6 bg-neutral-950 p-6 text-white">
      <h1 className="text-[clamp(1.5rem,5vw,3rem)] font-black">{state.teamName} vs 🤖 Team Robo</h1>
      <div className="w-full max-w-2xl">
        <Scoreboard state={state} />
      </div>
      <table className="w-full max-w-2xl border-collapse text-left">
        <thead>
          <tr className="border-b border-white/20 text-sm uppercase opacity-70">
            <th className="py-2">Player</th>
            <th className="py-2 text-right">Score</th>
            <th className="py-2 text-right">Full</th>
            <th className="py-2 text-right">Title only</th>
            <th className="py-2 text-right">Wrong</th>
            <th className="py-2 text-right">No answer</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.id} className="border-b border-white/10">
              <td className="py-2 text-lg font-semibold">{p.name}</td>
              <td className="py-2 text-right text-lg font-bold tabular-nums">{p.score}</td>
              <td className="py-2 text-right tabular-nums opacity-80">{p.full}</td>
              <td className="py-2 text-right tabular-nums opacity-80">{p.titleOnly}</td>
              <td className="py-2 text-right tabular-nums opacity-80">{p.wrong}</td>
              <td className="py-2 text-right tabular-nums opacity-80">{p.noAnswer}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {state.phase.name === 'GAME_OVER' && (
        <Link href="/" className="text-sm text-white/60 underline hover:text-white/80">
          Back to home
        </Link>
      )}
    </main>
  );
}
