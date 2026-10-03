import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { judgeQuizAnswer } from '@/lib/ai/judge';
import { buildTranscribePrompt, transcribeAnswer } from '@/lib/ai/transcribe';
import { scoreQuizAnswer } from '@/lib/game/scoring';
import { getQuestions, type QuestionSet } from '@/lib/questions';
import { getQuizBank, type QuizBankEntry } from '@/lib/quiz';

export const runtime = 'nodejs';
export const maxDuration = 30;

const mockBodySchema = z.object({
  index: z.number().int().min(0),
  text: z.string(),
  set: z.enum(['standard', 'hard']).optional(),
});

interface AnswerResponse {
  transcript: string;
  points: number;
  recorded: boolean;
  correctAnswer: string;
}

/**
 * Same transcribe -> judge -> score shape as /api/practice/answer, but
 * judges a single field (whichever the quiz asked for) instead of a
 * title+author pair. Fully stateless and public, same as practice. `set`
 * picks which bank `index` resolves against (standard, or the optional
 * harder set).
 */
export async function POST(request: NextRequest) {
  const mockAi = process.env.MOCK_AI === 'true';

  let entry: QuizBankEntry;
  let transcript: string;
  let recorded: boolean;
  let correct = false;

  if (mockAi) {
    const json = await request.json().catch(() => null);
    const parsed = mockBodySchema.safeParse(json);
    const set: QuestionSet = parsed.success && parsed.data.set === 'hard' ? 'hard' : 'standard';
    const bank = getQuizBank(set);
    if (!parsed.success || parsed.data.index >= bank.length) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    entry = bank[parsed.data.index];
    const expected = entry.kind === 'title' ? entry.title : entry.author;
    const result = await judgeQuizAnswer({ kind: entry.kind, expected, transcript: parsed.data.text });
    transcript = parsed.data.text;
    correct = result.correct;
    recorded = parsed.data.text.trim().length > 0 && !result.needsReview;
  } else {
    const form = await request.formData().catch(() => null);
    const indexRaw = form?.get('index');
    const setRaw = form?.get('set');
    const audio = form?.get('audio');
    const set: QuestionSet = setRaw === 'hard' ? 'hard' : 'standard';
    const bank = getQuizBank(set);
    const parsedIndex = typeof indexRaw === 'string' ? Number(indexRaw) : NaN;
    if (!Number.isInteger(parsedIndex) || parsedIndex < 0 || parsedIndex >= bank.length || !(audio instanceof Blob)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    entry = bank[parsedIndex];
    const filename = audio instanceof File && audio.name ? audio.name : 'answer.webm';

    try {
      transcript = await transcribeAnswer({ file: audio, filename, prompt: buildTranscribePrompt(getQuestions(set)) });
    } catch {
      return NextResponse.json({
        transcript: '',
        points: 0,
        recorded: false,
        correctAnswer: entry.kind === 'title' ? entry.title : entry.author,
      } satisfies AnswerResponse);
    }

    recorded = transcript.trim().length > 0;
    if (recorded) {
      const expected = entry.kind === 'title' ? entry.title : entry.author;
      const result = await judgeQuizAnswer({ kind: entry.kind, expected, transcript });
      correct = result.correct;
      recorded = !result.needsReview;
    }
  }

  const points = scoreQuizAnswer({ correct, recorded });
  return NextResponse.json({
    transcript,
    points,
    recorded,
    correctAnswer: entry.kind === 'title' ? entry.title : entry.author,
  } satisfies AnswerResponse);
}
