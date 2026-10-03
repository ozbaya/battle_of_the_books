import type { GameState } from '../game/types';
import type { Store } from './types';

declare global {
  var __battleOfTheBooksGames: Map<string, GameState> | undefined;
}

function gamesMap(): Map<string, GameState> {
  if (!globalThis.__battleOfTheBooksGames) {
    globalThis.__battleOfTheBooksGames = new Map();
  }
  return globalThis.__battleOfTheBooksGames;
}

/** In-memory store for local dev and tests. Not shared across server instances. */
export const memoryStore: Store = {
  async load(code) {
    const game = gamesMap().get(code);
    return game ? structuredClone(game) : null;
  },

  async create(code, state) {
    gamesMap().set(code, structuredClone(state));
  },

  async casSave(code, expectedVersion, nextState) {
    const current = gamesMap().get(code);
    if (!current || current.version !== expectedVersion) return false;
    gamesMap().set(code, structuredClone(nextState));
    return true;
  },
};
