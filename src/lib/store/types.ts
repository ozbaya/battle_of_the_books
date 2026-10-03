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
}
