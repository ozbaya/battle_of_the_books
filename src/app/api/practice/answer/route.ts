import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { judgeAnswer } from '@/lib/ai/judge';
import { transcribeAnswer } from '@/lib/ai/transcribe';
import { scoreAnswer } from '@/lib/game/scoring';
import type { Question } from '@/lib/game/types';
import { getQuestions } from '@/lib/questions';

export const runtime = 'nodejs';
export const maxDuration = 30;

const mockBodySchema = z.object({ index: z.number().int().min(0), text: z.string() });

function transcribePrompt(questions: Question[]): string {
  return questions.map((q) => `${q.title} by ${q.author}`).join('; ');
}

interface AnswerResponse {
  transcript: string;
  points: number;
  recorded: boolean;
  correctTitle: string;
  correctAuthor: string;
}

/**
 * Same transcribe -> judge -> score pipeline as /api/games/[code]/answer,
 * minus everything GameState-related: no store, no CAS, no Redis. Fully
 * stateless and public — a practice session needs no shared/multiplayer
 * state at all.
 */
export async function POST(request: NextRequest) {
  const mockAi = process.env.MOCK_AI === 'true';
  const questions = getQuestions();

  let index: number;
  let transcript: string;
  let recorded: boolean;
  let titleCorrect = false;
  let authorCorrect = false;

  if (mockAi) {
    const json = await request.json().catch(() => null);
    const parsed = mockBodySchema.safeParse(json);
    if (!parsed.success || parsed.data.index >= questions.length) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    index = parsed.data.index;
    const question = questions[index];
    const result = await judgeAnswer({
      question: question.question,
      title: question.title,
      author: question.author,
      transcript: parsed.data.text,
    });
    transcript = parsed.data.text;
    titleCorrect = result.titleCorrect;
    authorCorrect = result.authorCorrect;
    recorded = parsed.data.text.trim().length > 0 && !result.needsReview;
  } else {
    const form = await request.formData().catch(() => null);
    const indexRaw = form?.get('index');
    const audio = form?.get('audio');
    const parsedIndex = typeof indexRaw === 'string' ? Number(indexRaw) : NaN;
    if (!Number.isInteger(parsedIndex) || parsedIndex < 0 || parsedIndex >= questions.length || !(audio instanceof Blob)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    index = parsedIndex;
    const question = questions[index];
    const filename = audio instanceof File && audio.name ? audio.name : 'answer.webm';

    try {
      transcript = await transcribeAnswer({ file: audio, filename, prompt: transcribePrompt(questions) });
    } catch {
      return NextResponse.json({
        transcript: '',
        points: 0,
        recorded: false,
        correctTitle: question.title,
        correctAuthor: question.author,
      } satisfies AnswerResponse);
    }

    recorded = transcript.trim().length > 0;
    if (recorded) {
      const result = await judgeAnswer({
        question: question.question,
        title: question.title,
        author: question.author,
        transcript,
      });
      titleCorrect = result.titleCorrect;
      authorCorrect = result.authorCorrect;
      recorded = !result.needsReview;
    }
  }

  const question = questions[index];
  const points = scoreAnswer({ titleCorrect, authorCorrect, recorded });
  return NextResponse.json({
    transcript,
    points,
    recorded,
    correctTitle: question.title,
    correctAuthor: question.author,
  } satisfies AnswerResponse);
}
