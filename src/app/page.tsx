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
