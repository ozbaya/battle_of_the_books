import { describe, expect, it } from 'vitest';
import { aggregateUsageByName, logUsageBodySchema, type UsageSession } from './usage';

function session(overrides: Partial<UsageSession> = {}): UsageSession {
  return {
    id: 'x',
    mode: 'practice',
    name: 'Maya',
    endedAt: 0,
    totalQuestions: 10,
    correct: 5,
    titleOnly: 2,
    wrong: 2,
    noAnswer: 1,
    score: 11,
    ...overrides,
  };
}

describe('aggregateUsageByName', () => {
  it('sums every stat across a player\'s sessions', () => {
    const totals = aggregateUsageByName([
      session({ name: 'Maya', correct: 5, score: 11 }),
      session({ name: 'Maya', correct: 3, score: 5 }),
    ]);
    expect(totals).toEqual([
      {
        name: 'Maya',
        sessions: 2,
        totalQuestions: 20,
        correct: 8,
        titleOnly: 4,
        wrong: 4,
        noAnswer: 2,
        score: 16,
      },
    ]);
  });

  it('keeps separate players separate', () => {
    const totals = aggregateUsageByName([session({ name: 'Maya' }), session({ name: 'Leo' })]);
    expect(totals.map((t) => t.name).sort()).toEqual(['Leo', 'Maya']);
  });

  it('sorts by session count descending, then name', () => {
    const totals = aggregateUsageByName([
      session({ name: 'Ava' }),
      session({ name: 'Ben' }),
      session({ name: 'Ben' }),
    ]);
    expect(totals.map((t) => t.name)).toEqual(['Ben', 'Ava']);
  });

  it('returns an empty array for no sessions', () => {
    expect(aggregateUsageByName([])).toEqual([]);
  });
});

describe('logUsageBodySchema', () => {
  it('accepts a well-formed practice session', () => {
    const result = logUsageBodySchema.safeParse({
      mode: 'practice',
      name: 'Maya',
      totalQuestions: 10,
      correct: 5,
      titleOnly: 2,
      wrong: 2,
      noAnswer: 1,
      score: 11,
    });
    expect(result.success).toBe(true);
  });

  it('allows an omitted name (practice/quiz are anonymous by default)', () => {
    const result = logUsageBodySchema.safeParse({
      mode: 'quiz',
      totalQuestions: 10,
      correct: 0,
      titleOnly: 0,
      wrong: 0,
      noAnswer: 10,
      score: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a mode outside practice/quiz', () => {
    const result = logUsageBodySchema.safeParse({
      mode: 'team',
      totalQuestions: 10,
      correct: 0,
      titleOnly: 0,
      wrong: 0,
      noAnswer: 0,
      score: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative counts', () => {
    const result = logUsageBodySchema.safeParse({
      mode: 'practice',
      totalQuestions: 10,
      correct: -1,
      titleOnly: 0,
      wrong: 0,
      noAnswer: 0,
      score: 0,
    });
    expect(result.success).toBe(false);
  });
});
