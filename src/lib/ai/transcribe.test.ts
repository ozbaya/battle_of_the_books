import { describe, expect, it } from 'vitest';
import { buildTranscribePrompt } from './transcribe';
import type { Question } from '@/lib/game/types';

function question(title: string, author: string, n = 1): Question[] {
  return Array.from({ length: n }, (_, i) => ({ question: `Q${i}`, title, author }));
}

describe('buildTranscribePrompt', () => {
  it('deduplicates repeated title/author pairs', () => {
    const questions = [...question('Holes', 'Louis Sachar', 5), ...question('Matilda', 'Roald Dahl', 1)];
    const prompt = buildTranscribePrompt(questions);
    expect(prompt).toBe('Holes by Louis Sachar; Matilda by Roald Dahl');
  });

  it('never exceeds a safe character budget, even with many unique books', () => {
    const questions = Array.from({ length: 100 }, (_, i) => ({
      question: `Q${i}`,
      title: `Book Title Number ${i} With Some Extra Words`,
      author: `Author Name ${i}`,
    }));
    const prompt = buildTranscribePrompt(questions);
    expect(prompt.length).toBeLessThanOrEqual(850);
  });

  it(
    'regression: a question bank with many trivia questions per book does not let the last ' +
      'book dominate the (budget-capped) prompt — this reproduces the real "by Jonah Winter" ' +
      'hallucination bug, where Whisper\'s prompt silently truncates to its tail, and a tail of ' +
      'N duplicate entries left Whisper nothing else to lean on for near-silent audio',
    () => {
      const questions = [
        ...question('Holes', 'Louis Sachar', 3),
        ...question("Charlotte's Web", 'E.B. White', 2),
        // The real bank had 15 consecutive duplicate rows for one book at the end.
        ...question('You Never Heard of Sandy Koufax?!', 'Jonah Winter', 15),
      ];
      const prompt = buildTranscribePrompt(questions);
      const occurrences = prompt.split('Jonah Winter').length - 1;
      expect(occurrences).toBe(1);
      expect(prompt).toContain('Holes by Louis Sachar');
      expect(prompt).toContain("Charlotte's Web by E.B. White");
    }
  );

  it('returns an empty string for an empty question list', () => {
    expect(buildTranscribePrompt([])).toBe('');
  });
});
