'use client';

import { useEffect, useState } from 'react';
import type { PublicGameState } from '@/lib/game/engine';

export interface UseGameStateResult {
  state: PublicGameState | null;
  /** Add to Date.now() to get a server-aligned clock for countdowns. */
  clockOffset: number;
  error: string | null;
  loading: boolean;
}

const POLL_INTERVAL_MS = 600;

export function useGameState(code: string): UseGameStateResult {
  const [state, setState] = useState<PublicGameState | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function schedule() {
      if (stopped) return;
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    async function poll() {
      if (stopped) return;
      if (document.hidden) {
        schedule();
        return;
      }
      try {
        const res = await fetch(`/api/games/${code}/state`, { cache: 'no-store' });
        const body = await res.json().catch(() => null);
        if (stopped) return;
        if (res.ok && body) {
          setState(body as PublicGameState);
          setClockOffset((body as PublicGameState).serverNow - Date.now());
          setError(null);
        } else {
          setError(body?.error ?? 'Request failed');
        }
      } catch {
        if (!stopped) setError('Network error');
      } finally {
        if (!stopped) {
          setLoading(false);
          schedule();
        }
      }
    }

    poll();
    const onVisibilityChange = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [code]);

  return { state, clockOffset, error, loading };
}

export function serverAlignedNow(clockOffset: number): number {
  return Date.now() + clockOffset;
}
