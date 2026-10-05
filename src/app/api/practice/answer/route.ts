import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { judgeAnswer } from '@/lib/ai/judge';
import { buildTranscribePrompt, transcribeAnswer } from '@/lib/ai/transcribe';
import { scoreAnswer } from '@/lib/game/scoring';
import type { Question } from '@/lib/game/types';
import { getQuestions, parseQuestionSet } from '@/lib/questions';

export const runtime = 'nodejs';
export const maxDuration = 30;

const mockBodySchema = z.object({
  index: z.number().int().min(0),
  text: z.string(),
  set: z.enum(['standard', 'hard', 'superDuperHard', 'rishiMode']).optional(),
});

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
 * state at all. `set` picks which question bank `index` resolves against
 * (standard questions.md, or the optional hard.md / "super duper hard.md").
 */
export async function POST(request: NextRequest) {
  const mockAi = process.env.MOCK_AI === 'true';

  let question: Question;
  let transcript: string;
  let recorded: boolean;
  let titleCorrect = false;
  let authorCorrect = false;

  if (mockAi) {
    const json = await request.json().catch(() => null);
    const parsed = mockBodySchema.safeParse(json);
    const set = parseQuestionSet(parsed.success ? parsed.data.set : undefined);
    const questions = getQuestions(set);
    if (!parsed.success || parsed.data.index >= questions.length) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    question = questions[parsed.data.index];
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
    const setRaw = form?.get('set');
    const audio = form?.get('audio');
    const set = parseQuestionSet(typeof setRaw === 'string' ? setRaw : undefined);
    const questions = getQuestions(set);
    const parsedIndex = typeof indexRaw === 'string' ? Number(indexRaw) : NaN;
    if (!Number.isInteger(parsedIndex) || parsedIndex < 0 || parsedIndex >= questions.length || !(audio instanceof Blob)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    question = questions[parsedIndex];
    const filename = audio instanceof File && audio.name ? audio.name : 'answer.webm';

    try {
      transcript = await transcribeAnswer({ file: audio, filename, prompt: buildTranscribePrompt(questions) });
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

  const points = scoreAnswer({ titleCorrect, authorCorrect, recorded });
  return NextResponse.json({
    transcript,
    points,
    recorded,
    correctTitle: question.title,
    correctAuthor: question.author,
  } satisfies AnswerResponse);
}
