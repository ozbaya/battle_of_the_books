import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { judgeAnswer } from '@/lib/ai/judge';
import { applyJudgment, getCurrentQuestion, toPublicGameState } from '@/lib/game/engine';
import { getQuestions } from '@/lib/questions';
import { GameNotFoundError, updateGame } from '@/lib/store';

export const runtime = 'nodejs';
export const maxDuration = 30;

const bodySchema = z.object({ playerId: z.string().min(1), text: z.string() });

/**
 * MOCK_AI only this pass: the client sends typed text instead of a recorded
 * clip. Real multipart audio + Whisper + the OpenAI judge arrive in
 * Milestone 6, replacing this body shape without changing the route path.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (process.env.MOCK_AI !== 'true') {
    return NextResponse.json({ error: 'Only MOCK_AI text answers are supported in this build' }, { status: 501 });
  }

  const { code } = await params;
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const questions = getQuestions();
  try {
    // Advance + persist first, independent of the (here instant, later slow)
    // judging call, per CLAUDE.md §6: "each /answer request is independent;
    // only the final state write goes through CAS."
    const afterAdvance = await updateGame(code, questions, Date.now(), (s) => s);
    if (afterAdvance.phase.name !== 'KIDS_ROUND') {
      return NextResponse.json(toPublicGameState(afterAdvance, questions, Date.now()));
    }

    const questionIndexAtAnswer = afterAdvance.currentIndex;
    const question = getCurrentQuestion(afterAdvance, questions);
    const judged = await judgeAnswer({
      question: question.question,
      title: question.title,
      author: question.author,
      transcript: parsed.data.text,
    });
    const recorded = parsed.data.text.trim().length > 0;

    const final = await updateGame(code, questions, Date.now(), (s) => {
      // The question may have moved on while judging ran; don't apply a
      // stale judgment to the wrong question.
      if (s.phase.name !== 'KIDS_ROUND' || s.currentIndex !== questionIndexAtAnswer) return s;
      return applyJudgment(s, parsed.data.playerId, {
        transcript: parsed.data.text,
        titleCorrect: judged.titleCorrect,
        authorCorrect: judged.authorCorrect,
        recorded,
        needsReview: judged.needsReview,
      });
    });
    return NextResponse.json(toPublicGameState(final, questions, Date.now()));
  } catch (err) {
    if (err instanceof GameNotFoundError) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }
    throw err;
  }
}
