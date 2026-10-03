import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { judgeQuizAnswer } from '@/lib/ai/judge';
import { buildTranscribePrompt, transcribeAnswer } from '@/lib/ai/transcribe';
import { scoreQuizAnswer } from '@/lib/game/scoring';
import { getQuestions } from '@/lib/questions';
import { getQuizBank } from '@/lib/quiz';

export const runtime = 'nodejs';
export const maxDuration = 30;

const mockBodySchema = z.object({ index: z.number().int().min(0), text: z.string() });

interface AnswerResponse {
  transcript: string;
  points: number;
  recorded: boolean;
  correctAnswer: string;
}

/**
 * Same transcribe -> judge -> score shape as /api/practice/answer, but
 * judges a single field (whichever the quiz asked for) instead of a
 * title+author pair. Fully stateless and public, same as practice.
 */
export async function POST(request: NextRequest) {
  const mockAi = process.env.MOCK_AI === 'true';
  const bank = getQuizBank();

  let index: number;
  let transcript: string;
  let recorded: boolean;
  let correct = false;

  if (mockAi) {
    const json = await request.json().catch(() => null);
    const parsed = mockBodySchema.safeParse(json);
    if (!parsed.success || parsed.data.index >= bank.length) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    index = parsed.data.index;
    const entry = bank[index];
    const expected = entry.kind === 'title' ? entry.title : entry.author;
    const result = await judgeQuizAnswer({ kind: entry.kind, expected, transcript: parsed.data.text });
    transcript = parsed.data.text;
    correct = result.correct;
    recorded = parsed.data.text.trim().length > 0 && !result.needsReview;
  } else {
    const form = await request.formData().catch(() => null);
    const indexRaw = form?.get('index');
    const audio = form?.get('audio');
    const parsedIndex = typeof indexRaw === 'string' ? Number(indexRaw) : NaN;
    if (!Number.isInteger(parsedIndex) || parsedIndex < 0 || parsedIndex >= bank.length || !(audio instanceof Blob)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    index = parsedIndex;
    const entry = bank[index];
    const filename = audio instanceof File && audio.name ? audio.name : 'answer.webm';

    try {
      transcript = await transcribeAnswer({ file: audio, filename, prompt: buildTranscribePrompt(getQuestions()) });
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

  const entry = bank[index];
  const points = scoreQuizAnswer({ correct, recorded });
  return NextResponse.json({
    transcript,
    points,
    recorded,
    correctAnswer: entry.kind === 'title' ? entry.title : entry.author,
  } satisfies AnswerResponse);
}
