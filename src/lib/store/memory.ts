import type { GameState } from '../game/types';
import type { UsageSession } from '../usage';
import type { Store } from './types';

declare global {
  var __battleOfTheBooksGames: Map<string, GameState> | undefined;
  var __battleOfTheBooksUsage: UsageSession[] | undefined;
}

function gamesMap(): Map<string, GameState> {
  if (!globalThis.__battleOfTheBooksGames) {
    globalThis.__battleOfTheBooksGames = new Map();
  }
  return globalThis.__battleOfTheBooksGames;
}

const USAGE_LOG_CAP = 500;

function usageLog(): UsageSession[] {
  if (!globalThis.__battleOfTheBooksUsage) {
    globalThis.__battleOfTheBooksUsage = [];
  }
  return globalThis.__battleOfTheBooksUsage;
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

  async listCodes(limit) {
    return Array.from(gamesMap().values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((g) => g.code);
  },

  async forgetCode(code) {
    gamesMap().delete(code);
  },

  async delete(code) {
    gamesMap().delete(code);
  },

  async logUsage(session) {
    const log = usageLog();
    log.unshift(session);
    log.length = Math.min(log.length, USAGE_LOG_CAP);
  },

  async listUsage(limit) {
    return usageLog().slice(0, limit);
  },
};
