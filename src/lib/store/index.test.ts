import { describe, expect, it } from 'vitest';
import { GET_READY_DURATION_MS } from '../game/config';
import { advance, applyJoin, applyPress, applyStart, createGame } from '../game/engine';
import type { GameState, Phase, Question } from '../game/types';
import { memoryStore } from './memory';
import { CasConflictError, GameNotFoundError, updateGameWithStore } from './index';
import type { Store } from './types';

const QUESTIONS: Question[] = [{ question: 'Q0', title: 'Holes', author: 'Louis Sachar' }];

function freshGame(code: string): GameState {
  let state = createGame({
    code,
    teamName: 'Testers',
    difficulty: 'medium',
    numQuestions: 1,
    totalQuestions: QUESTIONS.length,
    seed: 1,
    now: 0,
    rng: () => 0,
  });
  state = applyJoin(state, 'maya', 'Maya');
  state = applyJoin(state, 'leo', 'Leo');
  return state;
}

/** A game already in its first KIDS_ROUND, ready for presses. */
function openedGame(code: string): GameState {
  let state = applyStart(freshGame(code), 0);
  state = advance(state, GET_READY_DURATION_MS, QUESTIONS);
  return state;
}

describe('updateGameWithStore', () => {
  it('bumps version by exactly 1 per successful write that actually changes something', async () => {
    const code = `V-${Math.random()}`;
    await memoryStore.create(code, freshGame(code));
    const after1 = await updateGameWithStore(memoryStore, code, QUESTIONS, 0, (s) => applyJoin(s, 'sam', 'Sam'));
    expect(after1.version).toBe(1);
    const after2 = await updateGameWithStore(memoryStore, code, QUESTIONS, 0, (s) => applyJoin(s, 'robin', 'Robin'));
    expect(after2.version).toBe(2);
  });

  it('skips the write entirely — no version bump — when advance() and the action are both no-ops', async () => {
    const code = `N-${Math.random()}`;
    await memoryStore.create(code, freshGame(code)); // LOBBY; advance() alone never leaves LOBBY
    let casSaveCalls = 0;
    const counting: Store = {
      ...memoryStore,
      async casSave(c, expected, next) {
        casSaveCalls += 1;
        return memoryStore.casSave(c, expected, next);
      },
    };
    const before = await memoryStore.load(code);
    const after = await updateGameWithStore(counting, code, QUESTIONS, 0, (s) => s); // identity action, nothing to do
    expect(after.version).toBe(before!.version);
    expect(casSaveCalls).toBe(0);
  });

  it('still writes when only advance() changes something, even for an identity action', async () => {
    const code = `A-${Math.random()}`;
    const state = applyStart(freshGame(code), 0); // GET_READY { opensAt: GET_READY_DURATION_MS }
    await memoryStore.create(code, state);
    // now is past opensAt, so advance() alone moves GET_READY -> KIDS_ROUND even though the action is identity.
    const after = await updateGameWithStore(memoryStore, code, QUESTIONS, GET_READY_DURATION_MS, (s) => s);
    expect(after.version).toBe(1);
    expect(after.phase.name).toBe('KIDS_ROUND');
  });

  it('throws GameNotFoundError for an unknown code', async () => {
    await expect(updateGameWithStore(memoryStore, 'NOPE', QUESTIONS, 0, (s) => s)).rejects.toThrow(
      GameNotFoundError
    );
  });

  it('resolves concurrent presses to exactly one winning first respondent', async () => {
    const code = `C-${Math.random()}`;
    const opened = openedGame(code);
    await memoryStore.create(code, opened);
    const pressAt = opened.phase.name === 'KIDS_ROUND' ? opened.phase.openedAt + 500 : 0;
    const [a, b] = await Promise.all([
      updateGameWithStore(memoryStore, code, QUESTIONS, pressAt, (s, now) => applyPress(s, 'maya', now).state),
      updateGameWithStore(memoryStore, code, QUESTIONS, pressAt, (s, now) => applyPress(s, 'leo', now).state),
    ]);
    // Both calls return a state; the store's final version reflects both writes.
    const final = await memoryStore.load(code);
    expect(final!.version).toBe(2);
    const phase = final!.phase as Extract<Phase, { name: 'KIDS_ROUND' }>;
    expect(['maya', 'leo']).toContain(phase.firstRespondent);
    expect(Object.keys(phase.answers).sort()).toEqual(['leo', 'maya']);
    // Sanity: both individual updateGame calls reported progress, not a thrown error.
    expect(a.version).toBeGreaterThan(0);
    expect(b.version).toBeGreaterThan(0);
  });

  it('retries on CAS conflict and succeeds within the retry budget', async () => {
    const code = `R-${Math.random()}`;
    await memoryStore.create(code, freshGame(code));
    let failuresLeft = 2;
    const flaky: Store = {
      ...memoryStore,
      async casSave(c, expected, next) {
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          return false;
        }
        return memoryStore.casSave(c, expected, next);
      },
    };
    const result = await updateGameWithStore(flaky, code, QUESTIONS, 0, (s) => applyJoin(s, 'sam', 'Sam'));
    expect(result.version).toBe(1);
    expect(failuresLeft).toBe(0);
  });

  it('throws CasConflictError when every retry is exhausted', async () => {
    const code = `X-${Math.random()}`;
    await memoryStore.create(code, freshGame(code));
    const alwaysFails: Store = {
      ...memoryStore,
      async casSave() {
        return false;
      },
    };
    await expect(
      updateGameWithStore(alwaysFails, code, QUESTIONS, 0, (s) => applyJoin(s, 'sam', 'Sam'))
    ).rejects.toThrow(CasConflictError);
  });
});
