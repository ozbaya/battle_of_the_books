import type { RobotPlan } from './types';

/**
 * Seeded PRNG (mulberry32). Never use Math.random() inside the engine: every
 * "random" decision must be a pure function of its inputs so that advance()
 * is idempotent across repeated/retried invocations (see CLAUDE.md §4.1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministically folds a sequence of values into a single 32-bit seed (FNV-1a). */
export function hashSeed(...parts: Array<string | number>): number {
  const str = parts.join(':');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface DeriveRobotPlanParams {
  seed: number;
  questionIndex: number;
  attempt: 'first' | 'steal';
  correctTitle: string;
  correctAuthor: string;
  distractorTitle: string;
  distractorAuthor: string;
  accuracy: number;
  authorRate: number;
}

/**
 * Pure function of (seed, questionIndex, attempt, ...question data). Calling
 * this twice with the same inputs — e.g. because a CAS write was retried —
 * always produces the same robot outcome.
 */
export function deriveRobotPlan(params: DeriveRobotPlanParams): RobotPlan {
  const rand = mulberry32(hashSeed(params.seed, params.questionIndex, params.attempt));
  const titleRoll = rand();
  const authorRoll = rand();
  const titleCorrect = titleRoll < params.accuracy;
  const authorCorrect = titleCorrect && authorRoll < params.authorRate;
  return {
    titleCorrect,
    authorCorrect,
    displayTitle: titleCorrect ? params.correctTitle : params.distractorTitle,
    displayAuthor: authorCorrect ? params.correctAuthor : params.distractorAuthor,
  };
}

/** Samples `count` distinct indices from [0, total) without replacement. */
export function sampleDistinct(total: number, count: number, rng: () => number): number[] {
  const pool = Array.from({ length: total }, (_, i) => i);
  const n = Math.min(count, total);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, n);
}
