'use client';

import { useEffect, useRef } from 'react';
import type { PublicGameState } from '@/lib/game/engine';
import { isAudioUnlocked, playSound } from '@/lib/sound';

/** Plays a button-press blip on a new press, and a correct/wrong chime whenever a new judged answer lands in history. */
export function useGameSounds(state: PublicGameState | null) {
  const prevAnswerCount = useRef(0);
  const prevHistoryLength = useRef(0);
  const primed = useRef(false);

  useEffect(() => {
    if (!state) return;

    const answerCount = state.phase.name === 'KIDS_ROUND' ? Object.keys(state.phase.answers).length : 0;

    if (!primed.current) {
      // First render for this game: just capture baseline, don't fire a
      // burst of sounds for history that already existed before we mounted.
      prevAnswerCount.current = answerCount;
      prevHistoryLength.current = state.history.length;
      primed.current = true;
      return;
    }

    if (isAudioUnlocked()) {
      if (answerCount > prevAnswerCount.current) {
        playSound('press');
      }
      if (state.history.length > prevHistoryLength.current) {
        const latest = state.history[state.history.length - 1];
        if (latest.points > 0) playSound('correct');
        else if (latest.points < 0) playSound('wrong');
      }
    }

    prevAnswerCount.current = answerCount;
    prevHistoryLength.current = state.history.length;
  }, [state]);
}
