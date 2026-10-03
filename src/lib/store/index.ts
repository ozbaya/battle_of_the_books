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
