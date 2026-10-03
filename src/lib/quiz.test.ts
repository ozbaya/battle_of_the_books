import { describe, expect, it } from 'vitest';
import { getQuizBank } from './quiz';
import { getQuestions, type QuestionSet } from './questions';

// Runs the same structural checks against both the standard set and the
// optional "hard" set (questions/hard.md) — content-agnostic either way, so
// these stay valid whether hard.md is still the empty placeholder or the
// admin has since filled it in with real questions.
describe.each<QuestionSet>(['standard', 'hard'])('getQuizBank(%s)', (set) => {
  it('yields exactly two entries (author + title) per unique book/author pair', () => {
    const uniquePairs = new Set(getQuestions(set).map((q) => `${q.title}|${q.author}`));
    const bank = getQuizBank(set);
    expect(bank.length).toBe(uniquePairs.size * 2);
  });

  it('indexes entries 0..n-1 in array order, so bank[index] is a direct lookup', () => {
    const bank = getQuizBank(set);
    bank.forEach((entry, i) => expect(entry.index).toBe(i));
  });

  it('pairs an author-kind and a title-kind entry for the same book back to back', () => {
    const bank = getQuizBank(set);
    for (let i = 0; i < bank.length; i += 2) {
      expect(bank[i].kind).toBe('author');
      expect(bank[i + 1].kind).toBe('title');
      expect(bank[i].title).toBe(bank[i + 1].title);
      expect(bank[i].author).toBe(bank[i + 1].author);
    }
  });

  it('phrases an author-kind prompt around the title, and a title-kind prompt around the author (skipped if the bank is empty)', () => {
    const bank = getQuizBank(set);
    const authorEntry = bank.find((e) => e.kind === 'author');
    const titleEntry = bank.find((e) => e.kind === 'title');
    if (!authorEntry || !titleEntry) return;
    expect(authorEntry.prompt).toContain(authorEntry.title);
    expect(authorEntry.prompt.toLowerCase()).toContain('author');
    expect(titleEntry.prompt).toContain(titleEntry.author);
    expect(titleEntry.prompt.toLowerCase()).toContain('title');
  });

  it('never repeats the same (title, author) pair', () => {
    const bank = getQuizBank(set);
    const pairs = new Set(bank.map((e) => `${e.title}|${e.author}`));
    expect(pairs.size).toBe(new Set(getQuestions(set).map((q) => `${q.title}|${q.author}`)).size);
  });
});
