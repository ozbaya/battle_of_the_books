import { describe, expect, it } from 'vitest';
import { getQuestions, parseQuestionsMarkdown, questionSetForDifficulty } from './questions';

describe('parseQuestionsMarkdown', () => {
  it('parses a valid table', () => {
    const md = `# Title\n\n| Question | Book Title | Author |\n|---|---|---|\n| Q1 | Holes | Louis Sachar |\n| Q2 | Matilda | Roald Dahl |\n`;
    expect(parseQuestionsMarkdown(md)).toEqual([
      { question: 'Q1', title: 'Holes', author: 'Louis Sachar' },
      { question: 'Q2', title: 'Matilda', author: 'Roald Dahl' },
    ]);
  });

  it('matches the header case-insensitively and trimmed', () => {
    const md = `|  question  |  BOOK TITLE  |  AUTHOR  |\n| - | - | - |\n| Q1 | Holes | Louis Sachar |\n`;
    expect(parseQuestionsMarkdown(md)).toEqual([{ question: 'Q1', title: 'Holes', author: 'Louis Sachar' }]);
  });

  it('allows an escaped pipe inside a cell', () => {
    const md = `| Question | Book Title | Author |\n|---|---|---|\n| Which book has a \\| in the title? | A \\| B | Someone |\n`;
    expect(parseQuestionsMarkdown(md)).toEqual([
      { question: 'Which book has a | in the title?', title: 'A | B', author: 'Someone' },
    ]);
  });

  it('throws with the line number and raw row text on an empty cell', () => {
    const md = `| Question | Book Title | Author |\n|---|---|---|\n| Q1 | | Louis Sachar |\n`;
    expect(() => parseQuestionsMarkdown(md)).toThrow(/line 3/);
    expect(() => parseQuestionsMarkdown(md)).toThrow(/Louis Sachar/);
  });

  it('ignores content outside the table', () => {
    const md = `Some notes up top.\n\n| Question | Book Title | Author |\n|---|---|---|\n| Q1 | Holes | Louis Sachar |\n\nSome notes at the bottom.\n`;
    expect(parseQuestionsMarkdown(md)).toEqual([{ question: 'Q1', title: 'Holes', author: 'Louis Sachar' }]);
  });

  it('uses the first table whose header matches, ignoring other tables', () => {
    const md = `| Foo | Bar |\n|---|---|\n| a | b |\n\n| Question | Book Title | Author |\n|---|---|---|\n| Q1 | Holes | Louis Sachar |\n`;
    expect(parseQuestionsMarkdown(md)).toEqual([{ question: 'Q1', title: 'Holes', author: 'Louis Sachar' }]);
  });

  it('strips simple Markdown emphasis from cells', () => {
    const md = '| Question | Book Title | Author |\n|---|---|---|\n| **Q1** | *Holes* | `Louis Sachar` |\n';
    expect(parseQuestionsMarkdown(md)).toEqual([{ question: 'Q1', title: 'Holes', author: 'Louis Sachar' }]);
  });

  it('throws when no matching table is found', () => {
    expect(() => parseQuestionsMarkdown('just some text, no table here')).toThrow(/no table found/);
  });
});

describe('getQuestions', () => {
  // Deliberately content-agnostic: questions/questions.md is edited by the
  // admin going forward, so this only checks structural validity, not any
  // particular seeded book.
  it('loads questions/questions.md with well-formed rows', () => {
    const questions = getQuestions();
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.every((q) => q.question.trim() && q.title.trim() && q.author.trim())).toBe(true);
  });

  // questions/hard.md is an admin-authored, optional "Hard" set for
  // Practice/Quiz — ships as an empty placeholder until the admin adds
  // rows. Must parse without throwing either way.
  it('loads questions/hard.md (currently an empty placeholder) without throwing', () => {
    expect(() => getQuestions('hard')).not.toThrow();
    const hardQuestions = getQuestions('hard');
    expect(hardQuestions.every((q) => q.question.trim() && q.title.trim() && q.author.trim())).toBe(true);
  });
});

describe('questionSetForDifficulty', () => {
  it('maps hard to the hard set', () => {
    expect(questionSetForDifficulty('hard')).toBe('hard');
  });

  it('maps easy and medium to the standard set', () => {
    expect(questionSetForDifficulty('easy')).toBe('standard');
    expect(questionSetForDifficulty('medium')).toBe('standard');
  });
});
