'use client';

import { useState } from 'react';
import { unlockAudio } from '@/lib/sound';

/** One-tap unlock per CLAUDE.md §8: browsers require a user gesture before audio can play. */
export function SoundToggle() {
  const [enabled, setEnabled] = useState(false);

  if (enabled) return null;

  return (
    <button
      type="button"
      onClick={() => {
        unlockAudio();
        setEnabled(true);
      }}
      className="fixed right-4 top-4 z-50 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur hover:bg-white/20"
    >
      🔊 Tap for sound
    </button>
  );
}
