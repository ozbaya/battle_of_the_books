'use client';

import { useEffect, useState } from 'react';

export interface LeaderboardEntry {
  name: string;
  score: number;
  isRobot: boolean;
}

// Not latency-sensitive — the one thing worth seeing move live is the
// robots' idle-time climb, which plays out over hours, so a slow poll is
// plenty responsive while staying gentle on quota.
const POLL_INTERVAL_MS = 30000;

/** Powers the home page's leaderboard; polls gently since nothing here is urgent. */
export function useLeaderboard(): { entries: LeaderboardEntry[]; loading: boolean } {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (stopped) return;
      if (!document.hidden) {
        try {
          const res = await fetch('/api/leaderboard', { cache: 'no-store' });
          if (res.ok) {
            const body = await res.json();
            if (!stopped) setEntries(body.leaderboard ?? []);
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

  return { entries, loading };
}
