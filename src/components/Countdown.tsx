'use client';

import { useEffect, useState } from 'react';
import { serverAlignedNow } from '@/lib/hooks/useGameState';

/** Re-renders every 100ms so countdowns tick smoothly between polls. */
export function useRemainingMs(targetMs: number | undefined, clockOffset: number): number {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 100);
    return () => clearInterval(id);
  }, []);
  if (targetMs === undefined) return 0;
  return Math.max(0, targetMs - serverAlignedNow(clockOffset));
}

export function Countdown({
  targetMs,
  clockOffset,
  className,
}: {
  targetMs: number;
  clockOffset: number;
  className?: string;
}) {
  const remainingMs = useRemainingMs(targetMs, clockOffset);
  const seconds = Math.ceil(remainingMs / 1000);
  return <span className={className}>{seconds}s</span>;
}
