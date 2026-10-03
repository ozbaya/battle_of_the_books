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

// Polling cadence depends on how time-sensitive the current phase is, to cut
// request (and Redis command) volume during long quiet stretches: nobody's
// racing a buzzer during LOBBY or a fixed REVEAL display, so those can poll
// more slowly than the active answering phases.
const FAST_POLL_INTERVAL_MS = 1000;
const SLOW_POLL_INTERVAL_MS = 2500;
const SLOW_PHASES = new Set(['LOBBY', 'REVEAL', 'GAME_OVER']);

function intervalForPhase(phaseName: string | undefined): number {
  return phaseName && SLOW_PHASES.has(phaseName) ? SLOW_POLL_INTERVAL_MS : FAST_POLL_INTERVAL_MS;
}

export function useGameState(code: string): UseGameStateResult {
  const [state, setState] = useState<PublicGameState | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let latestPhase: string | undefined;

    function schedule() {
      if (stopped) return;
      timer = setTimeout(poll, intervalForPhase(latestPhase));
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
          const publicState = body as PublicGameState;
          setState(publicState);
          setClockOffset(publicState.serverNow - Date.now());
          setError(null);
          latestPhase = publicState.phase.name;
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
