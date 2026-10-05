import type { Difficulty } from './types';

export const GET_READY_DURATION_MS = 3000;
export const FOLLOW_UP_WINDOW_MS = 10000;
export const STEAL_WINDOW_MS = 10000;
export const ROBOT_THINK_MS = 2500;
export const REVEAL_DURATION_MS = 6000;
export const RECORDING_DURATION_MS = 5000;
export const UPLOAD_GRACE_MS = 8000;
export const ANSWER_DEADLINE_MS = RECORDING_DURATION_MS + UPLOAD_GRACE_MS;

interface DifficultyConfig {
  robotDelayMs: number;
  accuracy: number;
  /** Of correct robot answers, the fraction that also get the author right. */
  authorRate: number;
}

export const DIFFICULTY_CONFIG: Record<Difficulty, DifficultyConfig> = {
  easy: { robotDelayMs: 7000, accuracy: 0.6, authorRate: 0.8 },
  medium: { robotDelayMs: 5000, accuracy: 0.6, authorRate: 0.8 },
  hard: { robotDelayMs: 5000, accuracy: 0.6, authorRate: 0.8 },
  superDuperHard: { robotDelayMs: 4000, accuracy: 0.6, authorRate: 0.8 },
};

export const CAS_MAX_RETRIES = 5;

export const SCORE = {
  FULL: 2,
  TITLE_ONLY: 1,
  WRONG: -0.5,
  NONE: 0,
} as const;

/** Guards advance()'s fixed-point loop against an infinite cycle from a misconfigured duration. */
export const ADVANCE_ITERATION_CAP = 500;

export const DEFAULT_NUM_QUESTIONS = 10;
