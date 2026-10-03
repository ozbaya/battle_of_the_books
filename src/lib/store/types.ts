import type { GameState } from '../game/types';

export interface Store {
  load(code: string): Promise<GameState | null>;
  create(code: string, state: GameState): Promise<void>;
  /**
   * Atomically overwrites the stored state only if its current `version`
   * still equals `expectedVersion`. Returns false on a conflict (someone
   * else wrote first) rather than throwing, so callers can retry.
   */
  casSave(code: string, expectedVersion: number, nextState: GameState): Promise<boolean>;
  /** Most-recently-created codes first, for the home page and admin lists. */
  listCodes(limit: number): Promise<string[]>;
  /** Best-effort cleanup when a listed code turns out to be gone (e.g. expired). No-op where irrelevant. */
  forgetCode(code: string): Promise<void>;
  /** Permanently removes a game (the admin's "delete dead game" action) — the key and its index entry. */
  delete(code: string): Promise<void>;
}
