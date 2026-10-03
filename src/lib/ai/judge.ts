import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

export interface JudgeInput {
  question: string;
  title: string;
  author: string;
  transcript: string;
}

export interface JudgeResult {
  titleCorrect: boolean;
  authorCorrect: boolean;
  reason: string;
  needsReview?: boolean;
}

const STOPWORDS = new Set(['the', 'a', 'an']);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .join(' ')
    .trim();
}

/**
 * Normalized fuzzy match used both as MOCK_AI's only judge and as the real
 * judge's fast path to skip the LLM call on an obviously-correct answer.
 * Never used to mark something *wrong* — unclear cases go to the LLM.
 */
export function fuzzyMatch(transcript: string, title: string, author: string): { titleCorrect: boolean; authorCorrect: boolean } {
  const normTranscript = normalize(transcript);
  const normTitle = normalize(title);
  const titleCorrect =
    normTranscript.length > 0 && normTitle.length > 0 && (normTranscript.includes(normTitle) || normTitle.includes(normTranscript));

  const authorWords = normalize(author).split(' ').filter(Boolean);
  const lastName = authorWords[authorWords.length - 1] ?? '';
  const authorCorrect = lastName.length > 0 && normTranscript.includes(lastName);

  return { titleCorrect, authorCorrect };
}

const judgmentSchema = z.object({
  titleCorrect: z.boolean(),
  authorCorrect: z.boolean(),
  reason: z.string(),
});

const SYSTEM_PROMPT = `You judge a child's answer in a spoken trivia game about books ("Battle of the Books").
The transcript comes from a child speaking quickly, converted by speech-to-text, which may contain
mistakes. Grade leniently — give credit whenever the kid most likely said the right answer:
- Accept misheard or misspelled words that sound like the right title or author.
- Ignore missing or extra articles ("the", "a"), punctuation, apostrophes, capitalization,
  author initials ("E.B. White" = "EB White" = "E White"), and filler words ("um", "I think it's…", "by").
- Accept a clearly identifiable partial title (e.g. "Wimpy Kid" for "Diary of a Wimpy Kid") and the
  author's last name alone.
- Title and author may be given in any order.
- Still mark titleCorrect false when it is plainly a different book.
- The author only counts as correct when the title is also correct — a correct author with a wrong
  title is still wrong overall (authorCorrect should still reflect whether the author was right, the
  caller handles the overall scoring).
- When genuinely unsure, lean toward giving credit.
Respond with titleCorrect, authorCorrect, and a one-sentence reason.`;

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

async function llmJudge(input: JudgeInput): Promise<JudgeResult> {
  const model = process.env.OPENAI_JUDGE_MODEL ?? 'gpt-4o-mini';
  const completion = await getClient().chat.completions.parse({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          question: input.question,
          expectedTitle: input.title,
          expectedAuthor: input.author,
          childsTranscript: input.transcript,
        }),
      },
    ],
    response_format: zodResponseFormat(judgmentSchema, 'judgment'),
  });

  const parsed = completion.choices[0]?.message?.parsed;
  if (!parsed) {
    return { titleCorrect: false, authorCorrect: false, reason: 'Judge returned no result.', needsReview: true };
  }
  return parsed;
}

export async function judgeAnswer(input: JudgeInput): Promise<JudgeResult> {
  const transcript = input.transcript.trim();
  if (!transcript) {
    return { titleCorrect: false, authorCorrect: false, reason: 'Empty transcript — nothing was said.' };
  }

  if (process.env.MOCK_AI === 'true') {
    const { titleCorrect, authorCorrect } = fuzzyMatch(transcript, input.title, input.author);
    return { titleCorrect, authorCorrect, reason: 'MOCK_AI: fuzzy match only.' };
  }

  const fast = fuzzyMatch(transcript, input.title, input.author);
  if (fast.titleCorrect) {
    return { titleCorrect: true, authorCorrect: fast.authorCorrect, reason: 'Fast path: clear fuzzy match.' };
  }

  try {
    return await llmJudge(input);
  } catch {
    // Don't stall the game on an OpenAI error — mark for the admin to review
    // manually; the caller scores this as 0 (not "wrong"), per CLAUDE.md §6.
    return { titleCorrect: false, authorCorrect: false, reason: 'Judging failed; needs manual review.', needsReview: true };
  }
}
