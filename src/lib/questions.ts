import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Difficulty, Question } from './game/types';

const questionRowSchema = z.object({
  question: z.string().min(1),
  title: z.string().min(1),
  author: z.string().min(1),
});

/** Splits a table row on unescaped `|`, trims cells, and drops a leading/trailing empty cell from the row's bounding pipes. */
function splitRow(line: string): string[] {
  const placeholder = '\u0000';
  const protectedLine = line.replace(/\\\|/g, placeholder);
  let cells = protectedLine.split('|').map((c) => c.split(placeholder).join('|'));
  if (cells.length > 0 && cells[0].trim() === '') cells = cells.slice(1);
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells = cells.slice(0, -1);
  return cells.map((c) => c.replace(/[*_`]/g, '').trim());
}

function isHeaderRow(line: string): boolean {
  const cells = splitRow(line).map((c) => c.toLowerCase());
  return cells.length === 3 && cells[0] === 'question' && cells[1] === 'book title' && cells[2] === 'author';
}

function isSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.includes('-') && /^[|\s:-]+$/.test(trimmed);
}

/**
 * Parses the first Markdown table whose header matches
 * "Question | Book Title | Author" (case-insensitive, trimmed). Anything
 * outside that table is ignored. Throws with the 1-based line number and raw
 * row text on a malformed row, so the admin can see exactly what to fix.
 */
export function parseQuestionsMarkdown(content: string): Question[] {
  const lines = content.split(/\r?\n/);

  let headerLineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('|') && isHeaderRow(lines[i])) {
      headerLineIndex = i;
      break;
    }
  }
  if (headerLineIndex === -1) {
    throw new Error('questions.md: no table found with header "Question | Book Title | Author"');
  }

  let cursor = headerLineIndex + 1;
  if (cursor < lines.length && isSeparatorRow(lines[cursor])) {
    cursor += 1;
  }

  const questions: Question[] = [];
  for (; cursor < lines.length; cursor++) {
    const raw = lines[cursor];
    if (!raw.trim().startsWith('|')) break;

    const cells = splitRow(raw);
    const parsed = questionRowSchema.safeParse({
      question: cells[0] ?? '',
      title: cells[1] ?? '',
      author: cells[2] ?? '',
    });
    if (!parsed.success) {
      throw new Error(`questions.md line ${cursor + 1}: invalid row (need Question | Book Title | Author, all non-empty) — "${raw.trim()}"`);
    }
    questions.push(parsed.data);
  }

  return questions;
}

/**
 * 'hard', 'superDuperHard' and 'rishiMode' are admin-authored, optional extra
 * question files (questions/hard.md, questions/"super duper hard.md",
 * questions/"rishi mode.md") for tougher Practice and team game rounds.
 * Empty until filled in.
 */
export type QuestionSet = 'standard' | 'hard' | 'superDuperHard' | 'rishiMode';

const QUESTION_FILES: Record<QuestionSet, string> = {
  standard: 'questions.md',
  hard: 'hard.md',
  superDuperHard: 'super duper hard.md',
  rishiMode: 'rishi mode.md',
};

export function getQuestions(set: QuestionSet = 'standard'): Question[] {
  const filePath = path.join(process.cwd(), 'questions', QUESTION_FILES[set]);
  const content = fs.readFileSync(filePath, 'utf8');
  return parseQuestionsMarkdown(content);
}

const DIFFICULTY_TO_SET: Record<Difficulty, QuestionSet> = {
  easy: 'standard',
  medium: 'standard',
  hard: 'hard',
  superDuperHard: 'superDuperHard',
  rishiMode: 'rishiMode',
};

/** Team games pick their question bank from their own difficulty: easy/medium use the standard set, hard uses hard.md, superDuperHard uses "super duper hard.md", rishiMode uses "rishi mode.md". */
export function questionSetForDifficulty(difficulty: Difficulty): QuestionSet {
  return DIFFICULTY_TO_SET[difficulty];
}

/** Parses a `?set=` query/body value from Practice's API routes, defaulting to 'standard' for anything unrecognized. */
export function parseQuestionSet(value: string | null | undefined): QuestionSet {
  if (value === 'hard') return 'hard';
  if (value === 'superDuperHard') return 'superDuperHard';
  if (value === 'rishiMode') return 'rishiMode';
  return 'standard';
}
