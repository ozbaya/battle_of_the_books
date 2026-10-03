import { CAS_MAX_RETRIES } from '../game/config';
import { advance } from '../game/engine';
import type { GameState, Question } from '../game/types';
import { memoryStore } from './memory';
import { redisStore } from './redis';
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

function hasRedisEnv(): boolean {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
      (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
  );
}

function pickStore(): Store {
  if (process.env.STORE === 'memory' || !hasRedisEnv()) return memoryStore;
  return redisStore;
}

export async function insertGame(code: string, state: GameState): Promise<void> {
  await pickStore().create(code, state);
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

/** "Recent games" list for /admin (includes finished games). */
export async function listRecentGames(): Promise<GameState[]> {
  return loadIndexedGames(20);
}

/** Public (unauthenticated) list for the home page: joinable games, i.e. not yet finished. */
export async function listActiveGames(): Promise<GameState[]> {
  const games = await loadIndexedGames(50);
  return games.filter((g) => g.phase.name !== 'GAME_OVER');
}

/**
 * load -> advance -> act -> CAS-save, retrying on conflict. Used by every
 * route, including the read-only /state poll (whose "action" is the identity
 * function) — this is how lazy time-based transitions actually get persisted
 * between client polls (CLAUDE.md §4.1).
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
    const next: GameState = { ...acted, version: advanced.version + 1 };
    const saved = await store.casSave(code, advanced.version, next);
    if (saved) return next;
  }
  throw new CasConflictError(code);
}
