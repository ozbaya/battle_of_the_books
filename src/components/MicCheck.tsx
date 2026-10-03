'use client';

import { useState } from 'react';
import { armMicrophone, type RecorderError } from '@/lib/audio/recorder';

export type MicCheckStatus = 'idle' | 'checking' | 'ok' | 'error';

export function useMicCheck() {
  const [status, setStatus] = useState<MicCheckStatus>('idle');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<RecorderError | null>(null);

  async function run(): Promise<boolean> {
    setStatus('checking');
    setError(null);
    const result = await armMicrophone((l) => setLevel(l));
    if (result.ok) {
      setStatus('ok');
      return true;
    }
    setStatus('error');
    setError(result.error);
    return false;
  }

  return { status, level, error, run };
}

export function MicLevelMeter({ level }: { level: number }) {
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
      <div
        className="h-full bg-emerald-500 transition-[width] duration-75"
        style={{ width: `${Math.round(level * 100)}%` }}
      />
    </div>
  );
}
