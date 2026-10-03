import type { QuestionSet } from './questions';
import type { UsageMode, UsageSession } from './usage';

export interface LeaderboardEntry {
  name: string;
  score: number;
  isRobot: boolean;
}

// --- Scoring ---------------------------------------------------------
//
// What makes a session worth more:
//  1. Volume + correctness: every recorded outcome except a true
//     non-answer earns something, and getting the full title+author right
//     earns the most — so both "answered a lot" and "got them right" push
//     the score up.
//  2. Harder content: a question drawn from questions/hard.md is worth
//     double one from the standard set.
//  3. Richer questions: Practice mode's "In what book does X happen?"
//     trivia (recall a plot clue, then state the full title *and* author)
//     outweighs Quiz mode's single-field "who wrote X" / "what book is
//     this" flashcards.
// On top of that, a flat bonus per session held in the last 12h rewards
// showing up often, not just having one great round.

const OUTCOME_POINTS = {
  correct: 3,
  titleOnly: 2,
  wrong: 1,
  noAnswer: 0,
} as const;

const DIFFICULTY_MULTIPLIER: Record<QuestionSet, number> = {
  standard: 1,
  hard: 2,
};

const MODE_MULTIPLIER: Record<UsageMode, number> = {
  practice: 1.5,
  quiz: 1,
};

const RECENT_SESSION_BONUS = 10;
const RECENT_WINDOW_MS = 12 * 60 * 60 * 1000;

/** Points earned by one logged round. Pure function of its own stored counts. */
export function sessionPoints(session: UsageSession): number {
  const difficulty: QuestionSet = session.difficulty ?? 'standard';
  const raw =
    session.correct * OUTCOME_POINTS.correct +
    session.titleOnly * OUTCOME_POINTS.titleOnly +
    session.wrong * OUTCOME_POINTS.wrong +
    session.noAnswer * OUTCOME_POINTS.noAnswer;
  return raw * MODE_MULTIPLIER[session.mode] * DIFFICULTY_MULTIPLIER[difficulty];
}

/** One entry per distinct logged name, summed across all their sessions (lifetime) plus the last-12h engagement bonus. */
export function aggregatePlayerScores(sessions: UsageSession[], now: number): LeaderboardEntry[] {
  const byName = new Map<string, number>();
  for (const session of sessions) {
    const recentBonus = now - session.endedAt <= RECENT_WINDOW_MS ? RECENT_SESSION_BONUS : 0;
    const points = sessionPoints(session) + recentBonus;
    byName.set(session.name, (byName.get(session.name) ?? 0) + points);
  }
  return Array.from(byName.entries()).map(([name, score]) => ({ name, score, isRobot: false }));
}

// --- Robots ------------------------------------------------------------
//
// A handful of silly robot competitors whose score is purely a function of
// how long it's been since *anyone* (any name, any mode) last finished a
// round — leave the board idle for a few hours and the robots start
// climbing past the real players, as a playful nudge to come back and
// practice. Each robot climbs at its own pace for a bit of personality.

interface RobotConfig {
  name: string;
  climbPerHour: number;
}

export const ROBOTS: RobotConfig[] = [
  { name: '🤖 Sir Reads-a-Lot', climbPerHour: 18 },
  { name: '🤖 Chapter Ate', climbPerHour: 14 },
  { name: '🤖 R2-Readtoo', climbPerHour: 11 },
  { name: '🤖 Byte Sized', climbPerHour: 8 },
  { name: '🤖 Shelf Awareness', climbPerHour: 6 },
];

// No session history at all (fresh install) shouldn't freeze the robots at
// a literal 0 — start their idle clock as if a couple of hours had already
// passed, so they're visible (if modest) from the very first page load.
const DEFAULT_IDLE_HOURS_WITH_NO_HISTORY = 2;

function idleHoursSinceLastSession(sessions: UsageSession[], now: number): number {
  if (sessions.length === 0) return DEFAULT_IDLE_HOURS_WITH_NO_HISTORY;
  const lastEndedAt = Math.max(...sessions.map((s) => s.endedAt));
  return Math.max(0, (now - lastEndedAt) / (60 * 60 * 1000));
}

export function robotEntries(sessions: UsageSession[], now: number): LeaderboardEntry[] {
  const idleHours = idleHoursSinceLastSession(sessions, now);
  return ROBOTS.map((robot) => ({
    name: robot.name,
    score: Math.round(idleHours * robot.climbPerHour),
    isRobot: true,
  }));
}

// The fastest natural climber doubles as the designated "rival" — when a
// human is genuinely in the lead (ahead of every robot's own idle-time
// score), it gets nudged up to just under the leader, so there's always a
// robot visibly nipping at the top human's heels instead of the whole pack
// trailing far behind. Capped below the leader (never at or past 100%), so
// this nudge alone never dethrones a human — only real idle time does that.
const RIVAL_ROBOT_NAME = ROBOTS[0].name;
const RIVAL_TARGET_FRACTION = 0.92;

/** Real players + robots, ranked together, highest score first. */
export function buildLeaderboard(sessions: UsageSession[], now: number, limit = 10): LeaderboardEntry[] {
  const players = aggregatePlayerScores(sessions, now);
  const robots = robotEntries(sessions, now);
  const combined = [...players, ...robots];

  if (combined.length > 0) {
    const topOverall = combined.reduce((best, e) => (e.score > best.score ? e : best));
    if (!topOverall.isRobot) {
      const rival = robots.find((r) => r.name === RIVAL_ROBOT_NAME);
      if (rival) {
        const target = Math.round(topOverall.score * RIVAL_TARGET_FRACTION);
        rival.score = Math.max(rival.score, target);
      }
    }
  }

  return combined.sort((a, b) => b.score - a.score).slice(0, limit);
}
