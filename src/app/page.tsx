'use client';

import Link from 'next/link';
import { useActiveGames } from '@/lib/hooks/useActiveGames';

const PHASE_LABEL: Record<string, string> = {
  LOBBY: 'Waiting to start',
  GET_READY: 'In progress',
  KIDS_ROUND: 'In progress',
  ROBOT_ANSWERING: 'In progress',
  REVEAL: 'In progress',
};

export default function HomePage() {
  const { games, loading } = useActiveGames();

  return (
    <main className="flex min-h-dvh flex-col items-center gap-8 bg-neutral-50 px-6 py-12 text-center dark:bg-neutral-950">
      <div>
        <h1 className="text-[clamp(2rem,6vw,3rem)] font-black">📚 Battle of the Books</h1>
        <p className="mt-1 text-lg opacity-70">Pick your team below to join the game!</p>
      </div>

      <details className="w-full max-w-md rounded-2xl bg-black/5 text-left open:pb-5 dark:bg-white/5">
        <summary className="cursor-pointer select-none px-6 py-4 font-bold">❓ How to play</summary>
        <div className="flex flex-col gap-3 px-6 text-sm opacity-80">
          <div>
            <p className="font-bold">🏆 Team game</p>
            <p>Join an open game below on your own phone, as part of your team. Everyone answers together, racing against a team of robots 🤖.</p>
          </div>
          <div>
            <p className="font-bold">🎯 Practice mode</p>
            <p>No team, no robots, no waiting for a host — just you working through questions on your own, whenever you want.</p>
          </div>
          <div>
            <p className="font-bold">🎤 Answering a question</p>
            <p>When a question shows up, press the big <strong>ANSWER</strong> button, then say your answer out loud — you&apos;ve got 5 seconds to record before it gets sent in.</p>
          </div>
        </div>
      </details>

      <div className="flex w-full max-w-md flex-col gap-3">
        {loading && <p className="opacity-60">Loading games…</p>}
        {!loading && games.length === 0 && (
          <p className="rounded-2xl bg-black/5 px-6 py-8 opacity-70 dark:bg-white/5">
            No games are open right now. Ask the host to create one!
          </p>
        )}
        {games.map((g) => (
          <Link
            key={g.code}
            href={`/play/${g.code}`}
            className="flex items-center justify-between rounded-2xl bg-emerald-500 px-6 py-5 text-left text-white shadow-lg transition-transform hover:bg-emerald-400 active:scale-95"
          >
            <span>
              <span className="block text-xl font-black">{g.teamName}</span>
              <span className="block text-sm opacity-90">
                {PHASE_LABEL[g.phase] ?? g.phase} · {g.playerCount} player{g.playerCount === 1 ? '' : 's'} joined
              </span>
            </span>
            <span className="text-2xl" aria-hidden>
              →
            </span>
          </Link>
        ))}
      </div>

      <Link
        href="/practice"
        className="flex w-full max-w-md items-center justify-between rounded-2xl bg-sky-500 px-6 py-5 text-left text-white shadow-lg transition-transform hover:bg-sky-400 active:scale-95"
      >
        <span>
          <span className="block text-xl font-black">🎯 Practice on your own</span>
          <span className="block text-sm opacity-90">No team needed — just you and the questions</span>
        </span>
        <span className="text-2xl" aria-hidden>
          →
        </span>
      </Link>

      <Link href="/admin" className="text-sm text-neutral-500 underline hover:text-neutral-700 dark:hover:text-neutral-300">
        Parent/host admin
      </Link>
    </main>
  );
}
