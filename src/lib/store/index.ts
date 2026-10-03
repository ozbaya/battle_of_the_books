import { CAS_MAX_RETRIES } from '../game/config';
import { advance } from '../game/engine';
import type { GameState, Question } from '../game/types';
import { memoryStore } from './memory';
import { findRedisCredentials, redisStore } from './redis';
import type { Store } from './types';

export class CasConflictError extends Error {
  constructor(code: string) {
    super(`Failed to save game ${code} after ${CAS_MAX_RETRIES} CAS conflicts`);
    this.name = 'CasConflictError';
  }
}

export class GameNotFoundError extends Error {
  constructor(code: string) {
    super(`Game ${code} not found`);
    this.name = 'GameNotFoundError';
  }
}

function pickStore(): Store {
  if (process.env.STORE === 'memory' || !findRedisCredentials()) return memoryStore;
  return redisStore;
}

/**
 * Surfaces which store is actually active and why — admin-only diagnostic
 * for the "it works locally but not on Vercel" class of bug, where the
 * silent fallback to the in-memory store (wrong/missing env var names, or
 * STORE=memory left set in production) is otherwise invisible.
 */
export function getStoreDiagnostics(): {
  active: 'memory' | 'redis';
  redisEnvDetected: boolean;
  storeEnvOverride: string | undefined;
} {
  return {
    active: pickStore() === memoryStore ? 'memory' : 'redis',
    redisEnvDetected: findRedisCredentials() !== null,
    storeEnvOverride: process.env.STORE,
  };
}

export async function insertGame(code: string, state: GameState): Promise<void> {
  await pickStore().create(code, state);
}

/** The admin's "delete dead game" action — permanent, not a soft/expire-only removal. */
export async function deleteGame(code: string): Promise<void> {
  await pickStore().delete(code);
}

export async function getGame(code: string): Promise<GameState | null> {
  return pickStore().load(code);
}

/**
 * Loads every game named in the store's recent-codes index, dropping (and
 * lazily forgetting) any code whose game has since expired. Works the same
 * way against both stores now that both implement listCodes()/forgetCode().
 */
async function loadIndexedGames(limit: number): Promise<GameState[]> {
  const store = pickStore();
  const codes = await store.listCodes(limit);
  const loaded = await Promise.all(
    codes.map(async (code) => {
      const state = await store.load(code);
      if (!state) await store.forgetCode(code);
      return state;
    })
  );
  return loaded.filter((g): g is GameState => g !== null);
}

// How many of the most-recently-created game codes to consider when building
// either list. Must be generous: a currently-active game must never be
// hidden from /admin just because enough other games (e.g. leftover test
// games) were created more recently than it — recency alone is the wrong
// filter for "games the admin needs to manage". 200 trades a one-time burst
// of store reads (only on an admin page load/refresh, never polled) for that
// guarantee holding in all but extreme cases.
const GAME_LIST_CANDIDATE_LIMIT = 200;
const RECENT_GAMES_DISPLAY_LIMIT = 30;

/** "Recent games" list for /admin: every active game, plus recent finished ones for history. */
export async function listRecentGames(): Promise<GameState[]> {
  const games = await loadIndexedGames(GAME_LIST_CANDIDATE_LIMIT);
  const active = games.filter((g) => g.phase.name !== 'GAME_OVER');
  const finished = games.filter((g) => g.phase.name === 'GAME_OVER');
  return [...active, ...finished].slice(0, RECENT_GAMES_DISPLAY_LIMIT);
}

/** Public (unauthenticated) list for the home page: joinable games, i.e. not yet finished. */
export async function listActiveGames(): Promise<GameState[]> {
  const games = await loadIndexedGames(GAME_LIST_CANDIDATE_LIMIT);
  return games.filter((g) => g.phase.name !== 'GAME_OVER');
}

/**
 * load -> advance -> act -> CAS-save, retrying on conflict. Used by every
 * route, including the read-only /state poll (whose "action" is the identity
 * function) — this is how lazy time-based transitions actually get persisted
 * between client polls (CLAUDE.md §4.1).
 *
 * When neither advance() nor the action actually changed anything — the
 * common case for a /state poll during a quiet stretch, or a press/join/etc.
 * that got rejected as a no-op — the write is skipped entirely (no version
 * bump, no Redis command) rather than writing an identical copy back. Every
 * no-op branch in engine.ts returns its input state by reference unchanged,
 * so a reference-equality check reliably detects this.
 */
export async function updateGame(
  code: string,
  questions: Question[],
  now: number,
  fn: (state: GameState, now: number) => GameState
): Promise<GameState> {
  return updateGameWithStore(pickStore(), code, questions, now, fn);
}

/** Exported separately so tests can inject a store that fails on demand. */
export async function updateGameWithStore(
  store: Store,
  code: string,
  questions: Question[],
  now: number,
  fn: (state: GameState, now: number) => GameState
): Promise<GameState> {
  for (let attempt = 0; attempt < CAS_MAX_RETRIES; attempt++) {
    const loaded = await store.load(code);
    if (!loaded) throw new GameNotFoundError(code);
    const advanced = advance(loaded, now, questions);
    const acted = fn(advanced, now);
    if (acted === loaded) return loaded;
    const next: GameState = { ...acted, version: advanced.version + 1 };
    const saved = await store.casSave(code, advanced.version, next);
    if (saved) return next;
  }
  throw new CasConflictError(code);
}
