import { getQuestions } from './questions';

export type QuizKind = 'title' | 'author';

export interface QuizBankEntry {
  index: number;
  kind: QuizKind;
  prompt: string;
  title: string;
  author: string;
}

function uniquePairs(): { title: string; author: string }[] {
  const seen = new Set<string>();
  const pairs: { title: string; author: string }[] = [];
  for (const q of getQuestions()) {
    const key = `${q.title}|${q.author}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ title: q.title, author: q.author });
  }
  return pairs;
}

/**
 * Deterministic bank of title<->author flashcard prompts, built from the
 * question file's unique book/author pairs. Each pair yields both
 * directions ("who's the author of X" and "what book did Y write") so a
 * round can mix them. The index ordering never depends on randomness, so
 * /api/quiz/answer and /api/quiz/answer-key can re-derive the expected
 * answer from just the index the client already has — the same stateless,
 * no-Redis pattern /api/practice uses (round selection/shuffling happens
 * client-side, same as practice mode).
 */
export function getQuizBank(): QuizBankEntry[] {
  const entries: QuizBankEntry[] = [];
  uniquePairs().forEach(({ title, author }, i) => {
    entries.push({ index: i * 2, kind: 'author', prompt: `Who is the author of "${title}"?`, title, author });
    entries.push({ index: i * 2 + 1, kind: 'title', prompt: `What is the title of the book written by ${author}?`, title, author });
  });
  return entries;
}
