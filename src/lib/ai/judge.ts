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
 * Normalized fuzzy match used both as MOCK_AI's only judge (this milestone)
 * and, from Milestone 6, as the real judge's fast path to skip the LLM call
 * on an obviously-correct answer. Never used to mark something *wrong* —
 * callers should send unclear cases to the LLM instead.
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

export async function judgeAnswer(input: JudgeInput): Promise<JudgeResult> {
  const transcript = input.transcript.trim();
  if (!transcript) {
    return { titleCorrect: false, authorCorrect: false, reason: 'Empty transcript — nothing was said.' };
  }

  if (process.env.MOCK_AI === 'true') {
    const { titleCorrect, authorCorrect } = fuzzyMatch(transcript, input.title, input.author);
    return { titleCorrect, authorCorrect, reason: 'MOCK_AI: fuzzy match only.' };
  }

  // Real OpenAI lenient-grading judge arrives in Milestone 6.
  throw new Error('judgeAnswer: real OpenAI judging is not implemented yet (set MOCK_AI=true for now)');
}
