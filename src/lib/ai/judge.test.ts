import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { parseMock } = vi.hoisted(() => ({ parseMock: vi.fn() }));

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    chat = { completions: { parse: parseMock } };
  },
}));

import { fuzzyMatch, fuzzyMatchSingle, judgeAnswer, judgeQuizAnswer } from './judge';

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

describe('judgeAnswer under MOCK_AI', () => {
  const originalMockAi = process.env.MOCK_AI;
  beforeEach(() => {
    process.env.MOCK_AI = 'true';
    parseMock.mockReset();
  });
  afterEach(() => {
    process.env.MOCK_AI = originalMockAi;
  });

  it('returns 0-equivalent result for an empty transcript without fuzzy matching', async () => {
    const result = await judgeAnswer({ question: 'Q', title: 'Holes', author: 'Louis Sachar', transcript: '   ' });
    expect(result).toEqual({ titleCorrect: false, authorCorrect: false, reason: expect.any(String) });
  });

  it('uses fuzzy matching only, never the LLM', async () => {
    const result = await judgeAnswer({
      question: 'Q',
      title: 'Holes',
      author: 'Louis Sachar',
      transcript: 'Holes by Louis Sachar',
    });
    expect(result.titleCorrect).toBe(true);
    expect(result.authorCorrect).toBe(true);
    expect(parseMock).not.toHaveBeenCalled();
  });
});

describe('judgeAnswer with real judging (MOCK_AI=false)', () => {
  const originalMockAi = process.env.MOCK_AI;
  beforeEach(() => {
    process.env.MOCK_AI = 'false';
    parseMock.mockReset();
  });
  afterEach(() => {
    process.env.MOCK_AI = originalMockAi;
  });

  it('skips the LLM call via the fast path on a clear fuzzy match', async () => {
    const result = await judgeAnswer({
      question: 'Q',
      title: 'Holes',
      author: 'Louis Sachar',
      transcript: 'Holes by Louis Sachar',
    });
    expect(result.titleCorrect).toBe(true);
    expect(parseMock).not.toHaveBeenCalled();
  });

  it('falls back to the LLM for an ambiguous transcript and trusts its structured result', async () => {
    parseMock.mockResolvedValueOnce({
      choices: [{ message: { parsed: { titleCorrect: true, authorCorrect: false, reason: 'misheard title' } } }],
    });
    const result = await judgeAnswer({ question: 'Q', title: 'Holes', author: 'Louis Sachar', transcript: 'Howls' });
    expect(parseMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ titleCorrect: true, authorCorrect: false, reason: 'misheard title' });
  });

  it('marks needsReview instead of crashing when the OpenAI call fails', async () => {
    parseMock.mockRejectedValueOnce(new Error('API down'));
    const result = await judgeAnswer({ question: 'Q', title: 'Holes', author: 'Louis Sachar', transcript: 'Howls' });
    expect(result.needsReview).toBe(true);
    expect(result.titleCorrect).toBe(false);
  });
});

describe('fuzzyMatchSingle', () => {
  it('matches the title when asked for the title', () => {
    expect(fuzzyMatchSingle('the holes', 'Holes', 'title')).toBe(true);
  });

  it('matches the author last name when asked for the author', () => {
    expect(fuzzyMatchSingle('I think it was Sachar', 'Louis Sachar', 'author')).toBe(true);
  });

  it('does not match a plainly different title or author', () => {
    expect(fuzzyMatchSingle('Matilda', 'Holes', 'title')).toBe(false);
    expect(fuzzyMatchSingle('Roald Dahl', 'Louis Sachar', 'author')).toBe(false);
  });

  it('never matches an empty transcript', () => {
    expect(fuzzyMatchSingle('', 'Holes', 'title')).toBe(false);
  });
});

describe('judgeQuizAnswer under MOCK_AI', () => {
  const originalMockAi = process.env.MOCK_AI;
  beforeEach(() => {
    process.env.MOCK_AI = 'true';
    parseMock.mockReset();
  });
  afterEach(() => {
    process.env.MOCK_AI = originalMockAi;
  });

  it('grades a title-kind question via fuzzy match only', async () => {
    const result = await judgeQuizAnswer({ kind: 'title', expected: 'Holes', transcript: 'Holes' });
    expect(result.correct).toBe(true);
    expect(parseMock).not.toHaveBeenCalled();
  });

  it('grades an author-kind question via fuzzy match only', async () => {
    const result = await judgeQuizAnswer({ kind: 'author', expected: 'Louis Sachar', transcript: 'Sachar' });
    expect(result.correct).toBe(true);
    expect(parseMock).not.toHaveBeenCalled();
  });

  it('returns incorrect for an empty transcript', async () => {
    const result = await judgeQuizAnswer({ kind: 'title', expected: 'Holes', transcript: '  ' });
    expect(result.correct).toBe(false);
  });
});

describe('judgeQuizAnswer with real judging (MOCK_AI=false)', () => {
  const originalMockAi = process.env.MOCK_AI;
  beforeEach(() => {
    process.env.MOCK_AI = 'false';
    parseMock.mockReset();
  });
  afterEach(() => {
    process.env.MOCK_AI = originalMockAi;
  });

  it('skips the LLM call via the fast path on a clear fuzzy match', async () => {
    const result = await judgeQuizAnswer({ kind: 'author', expected: 'Louis Sachar', transcript: 'Louis Sachar' });
    expect(result.correct).toBe(true);
    expect(parseMock).not.toHaveBeenCalled();
  });

  it('falls back to the LLM for an ambiguous transcript and trusts its structured result', async () => {
    parseMock.mockResolvedValueOnce({ choices: [{ message: { parsed: { correct: true, reason: 'misheard but close enough' } } }] });
    const result = await judgeQuizAnswer({ kind: 'author', expected: 'Louis Sachar', transcript: 'Lewis Sacker' });
    expect(parseMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ correct: true, reason: 'misheard but close enough' });
  });

  it('marks needsReview instead of crashing when the OpenAI call fails', async () => {
    parseMock.mockRejectedValueOnce(new Error('API down'));
    const result = await judgeQuizAnswer({ kind: 'title', expected: 'Holes', transcript: 'Howls' });
    expect(result.needsReview).toBe(true);
    expect(result.correct).toBe(false);
  });
});
