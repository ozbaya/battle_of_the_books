import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fuzzyMatch, judgeAnswer } from './judge';

describe('fuzzyMatch', () => {
  it('matches an exact title and full author', () => {
    const r = fuzzyMatch('Holes by Louis Sachar', 'Holes', 'Louis Sachar');
    expect(r).toEqual({ titleCorrect: true, authorCorrect: true });
  });

  it('ignores missing/extra articles', () => {
    const r = fuzzyMatch('the holes', 'Holes', 'Louis Sachar');
    expect(r.titleCorrect).toBe(true);
  });

  it('matches an apostrophe variant of the title', () => {
    const r = fuzzyMatch('Charlottes Web', "Charlotte's Web", 'E.B. White');
    expect(r.titleCorrect).toBe(true);
  });

  it('accepts the author last name alone', () => {
    const r = fuzzyMatch('I think it was Sachar', 'Holes', 'Louis Sachar');
    expect(r.authorCorrect).toBe(true);
  });

  it('accepts a clearly identifiable partial title', () => {
    const r = fuzzyMatch('Wimpy Kid', 'Diary of a Wimpy Kid', 'Jeff Kinney');
    expect(r.titleCorrect).toBe(true);
  });

  it('does not match a plainly different book or author', () => {
    const r = fuzzyMatch('Matilda by Roald Dahl', 'Holes', 'Louis Sachar');
    expect(r).toEqual({ titleCorrect: false, authorCorrect: false });
  });
});

describe('judgeAnswer', () => {
  const originalMockAi = process.env.MOCK_AI;
  beforeEach(() => {
    process.env.MOCK_AI = 'true';
  });
  afterEach(() => {
    process.env.MOCK_AI = originalMockAi;
    vi.unstubAllEnvs();
  });

  it('returns 0-equivalent result for an empty transcript without fuzzy matching', async () => {
    const result = await judgeAnswer({ question: 'Q', title: 'Holes', author: 'Louis Sachar', transcript: '   ' });
    expect(result).toEqual({ titleCorrect: false, authorCorrect: false, reason: expect.any(String) });
  });

  it('uses fuzzy matching under MOCK_AI', async () => {
    const result = await judgeAnswer({
      question: 'Q',
      title: 'Holes',
      author: 'Louis Sachar',
      transcript: 'Holes by Louis Sachar',
    });
    expect(result.titleCorrect).toBe(true);
    expect(result.authorCorrect).toBe(true);
  });

  it('rejects real judging when MOCK_AI is not set', async () => {
    process.env.MOCK_AI = 'false';
    await expect(
      judgeAnswer({ question: 'Q', title: 'Holes', author: 'Louis Sachar', transcript: 'Holes by Louis Sachar' })
    ).rejects.toThrow(/not implemented/);
  });
});
