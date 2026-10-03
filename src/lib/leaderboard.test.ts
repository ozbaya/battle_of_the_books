import { describe, expect, it } from 'vitest';
import { aggregatePlayerScores, buildLeaderboard, robotEntries, sessionPoints, ROBOTS } from './leaderboard';
import type { UsageSession } from './usage';

const HOUR = 60 * 60 * 1000;

function session(overrides: Partial<UsageSession> = {}): UsageSession {
  return {
    id: 'x',
    mode: 'practice',
    name: 'Maya',
    difficulty: 'standard',
    endedAt: 0,
    totalQuestions: 10,
    correct: 0,
    titleOnly: 0,
    wrong: 0,
    noAnswer: 0,
    score: 0,
    ...overrides,
  };
}

describe('sessionPoints', () => {
  it('scores correct > titleOnly > wrong > no answer', () => {
    expect(sessionPoints(session({ correct: 1 }))).toBeGreaterThan(sessionPoints(session({ titleOnly: 1 })));
    expect(sessionPoints(session({ titleOnly: 1 }))).toBeGreaterThan(sessionPoints(session({ wrong: 1 })));
    expect(sessionPoints(session({ wrong: 1 }))).toBeGreaterThan(sessionPoints(session({ noAnswer: 1 })));
    expect(sessionPoints(session({ noAnswer: 5 }))).toBe(0);
  });

  it('answering more questions scores higher, all else equal', () => {
    const few = sessionPoints(session({ correct: 1 }));
    const many = sessionPoints(session({ correct: 5 }));
    expect(many).toBeGreaterThan(few);
  });

  it('a hard-set session scores double a standard one with identical results', () => {
    const standard = sessionPoints(session({ difficulty: 'standard', correct: 4 }));
    const hard = sessionPoints(session({ difficulty: 'hard', correct: 4 }));
    expect(hard).toBe(standard * 2);
  });

  it('practice mode ("in what book") outscores quiz mode for identical results', () => {
    const practice = sessionPoints(session({ mode: 'practice', correct: 4 }));
    const quiz = sessionPoints(session({ mode: 'quiz', correct: 4 }));
    expect(practice).toBeGreaterThan(quiz);
  });

  it('treats a missing difficulty field (pre-existing sessions) as standard', () => {
    const explicit = sessionPoints(session({ difficulty: 'standard', correct: 3 }));
    const withoutDifficulty: UsageSession = session({ correct: 3 });
    delete withoutDifficulty.difficulty;
    expect(sessionPoints(withoutDifficulty)).toBe(explicit);
  });
});

describe('aggregatePlayerScores', () => {
  it('sums points across a player\'s sessions', () => {
    const now = 10 * HOUR;
    const entries = aggregatePlayerScores(
      [session({ name: 'Maya', correct: 3, endedAt: now - HOUR }), session({ name: 'Maya', correct: 2, endedAt: now - 2 * HOUR })],
      now
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('Maya');
    expect(entries[0].isRobot).toBe(false);
  });

  it('adds a bonus for each session within the last 12 hours, not for older ones', () => {
    const now = 20 * HOUR;
    const recentOnly = aggregatePlayerScores([session({ name: 'Maya', correct: 1, endedAt: now - HOUR })], now);
    const oldOnly = aggregatePlayerScores([session({ name: 'Leo', correct: 1, endedAt: now - 20 * HOUR })], now);
    expect(recentOnly[0].score).toBeGreaterThan(oldOnly[0].score);
  });

  it('keeps different names as separate entries', () => {
    const entries = aggregatePlayerScores([session({ name: 'Maya' }), session({ name: 'Leo' })], HOUR);
    expect(entries.map((e) => e.name).sort()).toEqual(['Leo', 'Maya']);
  });
});

describe('robotEntries', () => {
  it('scores every configured robot, all marked isRobot', () => {
    const entries = robotEntries([session({ endedAt: 0 })], 5 * HOUR);
    expect(entries).toHaveLength(ROBOTS.length);
    expect(entries.every((e) => e.isRobot)).toBe(true);
  });

  it('climbs the longer it has been since the last session', () => {
    const sessions = [session({ endedAt: 0 })];
    const soon = robotEntries(sessions, HOUR)[0].score;
    const later = robotEntries(sessions, 10 * HOUR)[0].score;
    expect(later).toBeGreaterThan(soon);
  });

  it('is near zero right after a session just ended', () => {
    const entries = robotEntries([session({ endedAt: 100 * HOUR })], 100 * HOUR);
    expect(entries.every((e) => e.score === 0)).toBe(true);
  });

  it('still shows robots with a modest score when there is no session history at all', () => {
    const entries = robotEntries([], 100 * HOUR);
    expect(entries.every((e) => e.score > 0)).toBe(true);
  });
});

describe('buildLeaderboard', () => {
  it('ranks real players and robots together, highest score first', () => {
    const now = 100 * HOUR;
    const sessions = [session({ name: 'Maya', correct: 10, endedAt: now - HOUR })];
    const leaderboard = buildLeaderboard(sessions, now);
    for (let i = 1; i < leaderboard.length; i++) {
      expect(leaderboard[i - 1].score).toBeGreaterThanOrEqual(leaderboard[i].score);
    }
  });

  it('lets robots overtake the top of the board once the board has been idle long enough', () => {
    const now = 100 * HOUR;
    // One modest session, then a very long idle stretch before "now".
    const sessions = [session({ name: 'Maya', correct: 2, endedAt: now - 99 * HOUR })];
    const leaderboard = buildLeaderboard(sessions, now);
    expect(leaderboard[0].isRobot).toBe(true);
  });

  it('respects the limit', () => {
    const sessions = Array.from({ length: 20 }, (_, i) => session({ name: `Player${i}`, correct: i }));
    expect(buildLeaderboard(sessions, 0, 3)).toHaveLength(3);
  });

  it('nudges one robot close to (but below) a human leader, leaving the rest of the pack untouched', () => {
    const now = 0;
    // Just logged, so robots' natural idle-based scores are ~0 — far below
    // a solid human score — and the human leader is also "recent" (no idle
    // time has passed since their own session).
    const sessions = [session({ name: 'Maya', correct: 10, endedAt: now })];
    const leaderboard = buildLeaderboard(sessions, now);

    expect(leaderboard[0].name).toBe('Maya');
    expect(leaderboard[0].isRobot).toBe(false);

    const rival = leaderboard.find((e) => e.name === ROBOTS[0].name)!;
    expect(rival.score).toBeLessThan(leaderboard[0].score);
    expect(rival.score).toBeGreaterThan(leaderboard[0].score * 0.8); // "close"

    // Every other robot stays at its untouched, natural (here: ~0) score.
    for (const robot of ROBOTS.slice(1)) {
      const entry = leaderboard.find((e) => e.name === robot.name);
      if (entry) expect(entry.score).toBe(0);
    }
  });

  it('never lowers the rival robot below what its own idle time already earned', () => {
    const now = 100 * HOUR;
    // Long idle stretch: the rival robot's natural climb alone already
    // exceeds 92% of a modest human score, so the nudge must not reduce it.
    const sessions = [session({ name: 'Maya', correct: 1, endedAt: now - 50 * HOUR })];
    const naturalRivalScore = robotEntries(sessions, now).find((r) => r.name === ROBOTS[0].name)!.score;
    const leaderboard = buildLeaderboard(sessions, now);
    const rival = leaderboard.find((e) => e.name === ROBOTS[0].name)!;
    expect(rival.score).toBeGreaterThanOrEqual(naturalRivalScore);
  });

  it('does not nudge any robot when no human has logged a session at all', () => {
    const now = 3 * HOUR;
    const natural = robotEntries([], now);
    const leaderboard = buildLeaderboard([], now);
    for (const robot of natural) {
      expect(leaderboard.find((e) => e.name === robot.name)!.score).toBe(robot.score);
    }
  });
});
