import { z } from 'zod';
import type { QuestionSet } from './questions';

/**
 * A single completed (or early-finished) solo round, logged for the admin
 * "usage" view. Practice and quiz mode are deliberately stateless on the
 * server (no team/game record at all), so this is the only thing that
 * outlives a single session. Team games are intentionally not tracked here.
 */
export type UsageMode = 'practice' | 'quiz';

export interface UsageSession {
  id: string;
  mode: UsageMode;
  name: string;
  endedAt: number;
  totalQuestions: number;
  correct: number;
  titleOnly: number;
  wrong: number;
  noAnswer: number;
  score: number;
  /** Which question set the round drew from — feeds the home page leaderboard's difficulty weighting. Quiz mode (no Hard option) always logs 'standard'. Optional/defaults to 'standard' for sessions logged before this field existed. */
  difficulty?: QuestionSet;
}

// Bounds generous enough for any real round/game, tight enough to reject
// garbage from a malformed or abusive request to the public log endpoint.
export const logUsageBodySchema = z.object({
  mode: z.enum(['practice', 'quiz']),
  name: z.string().trim().max(60).optional(),
  difficulty: z.enum(['standard', 'hard', 'superDuperHard', 'rishiMode']).optional(),
  totalQuestions: z.number().int().min(0).max(1000),
  correct: z.number().int().min(0).max(1000),
  titleOnly: z.number().int().min(0).max(1000),
  wrong: z.number().int().min(0).max(1000),
  noAnswer: z.number().int().min(0).max(1000),
  score: z.number().min(-1000).max(1000),
});

export interface UsageTotals {
  name: string;
  sessions: number;
  totalQuestions: number;
  correct: number;
  titleOnly: number;
  wrong: number;
  noAnswer: number;
  score: number;
}

/** Aggregates the raw session log into one row per name, for the admin summary table. */
export function aggregateUsageByName(sessions: UsageSession[]): UsageTotals[] {
  const byName = new Map<string, UsageTotals>();
  for (const s of sessions) {
    const existing = byName.get(s.name) ?? {
      name: s.name,
      sessions: 0,
      totalQuestions: 0,
      correct: 0,
      titleOnly: 0,
      wrong: 0,
      noAnswer: 0,
      score: 0,
    };
    existing.sessions += 1;
    existing.totalQuestions += s.totalQuestions;
    existing.correct += s.correct;
    existing.titleOnly += s.titleOnly;
    existing.wrong += s.wrong;
    existing.noAnswer += s.noAnswer;
    existing.score += s.score;
    byName.set(s.name, existing);
  }
  return Array.from(byName.values()).sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
}
