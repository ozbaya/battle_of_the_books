'use client';

import { useEffect, useState } from 'react';

export interface ActiveGameSummary {
  code: string;
  teamName: string;
  playerCount: number;
  phase: string;
}

const POLL_INTERVAL_MS = 3000;

/** Powers the home page's list of joinable games; polls gently since it's not latency-sensitive. */
export function useActiveGames(): { games: ActiveGameSummary[]; loading: boolean } {
  const [games, setGames] = useState<ActiveGameSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (stopped) return;
      if (!document.hidden) {
        try {
          const res = await fetch('/api/games', { cache: 'no-store' });
          if (res.ok) {
            const body = await res.json();
            if (!stopped) setGames(body.games ?? []);
          }
        } catch {
          // transient network error — just try again next tick
        } finally {
          if (!stopped) setLoading(false);
        }
      }
      if (!stopped) timer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { games, loading };
}
