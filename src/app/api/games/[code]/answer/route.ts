import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { judgeAnswer } from '@/lib/ai/judge';
import { buildTranscribePrompt, transcribeAnswer } from '@/lib/ai/transcribe';
import { applyJudgment, getCurrentQuestion, toPublicGameState } from '@/lib/game/engine';
import { getQuestions } from '@/lib/questions';
import { GameNotFoundError, updateGame } from '@/lib/store';

export const runtime = 'nodejs';
export const maxDuration = 30;

const mockBodySchema = z.object({ playerId: z.string().min(1), text: z.string() });

interface Judged {
  playerId: string;
  transcript: string;
  titleCorrect: boolean;
  authorCorrect: boolean;
  recorded: boolean;
  needsReview?: boolean;
}

/**
 * Every recording goes through the same pipeline (CLAUDE.md §6): transcribe
 * -> evaluate -> score. Under MOCK_AI the client sends typed text instead of
 * a clip, skipping transcription; otherwise it's real multipart audio.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const mockAi = process.env.MOCK_AI === 'true';
  const questions = getQuestions();

  try {
    // Advance + persist first, independent of the (here instant, later slow
    // for real audio) judging call — only the final state write goes
    // through CAS, per CLAUDE.md §6.
    const afterAdvance = await updateGame(code, questions, Date.now(), (s) => s);
    if (afterAdvance.phase.name !== 'KIDS_ROUND') {
      return NextResponse.json(toPublicGameState(afterAdvance, questions, Date.now(), mockAi));
    }
    const questionIndexAtAnswer = afterAdvance.currentIndex;
    const question = getCurrentQuestion(afterAdvance, questions);

    let judged: Judged;

    if (mockAi) {
      const json = await request.json().catch(() => null);
      const parsed = mockBodySchema.safeParse(json);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
      }
      const result = await judgeAnswer({
        question: question.question,
        title: question.title,
        author: question.author,
        transcript: parsed.data.text,
      });
      judged = {
        playerId: parsed.data.playerId,
        transcript: parsed.data.text,
        titleCorrect: result.titleCorrect,
        authorCorrect: result.authorCorrect,
        recorded: parsed.data.text.trim().length > 0 && !result.needsReview,
        needsReview: result.needsReview,
      };
    } else {
      const form = await request.formData().catch(() => null);
      const playerId = form?.get('playerId');
      const audio = form?.get('audio');
      if (typeof playerId !== 'string' || !playerId || !(audio instanceof Blob)) {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
      }
      const filename = audio instanceof File && audio.name ? audio.name : 'answer.webm';

      let transcript: string;
      try {
        transcript = await transcribeAnswer({ file: audio, filename, prompt: buildTranscribePrompt(questions) });
      } catch {
        // Don't stall the game on a transcription failure: needs manual review, 0 for now.
        judged = { playerId, transcript: '', titleCorrect: false, authorCorrect: false, recorded: false, needsReview: true };
        const final = await updateGame(code, questions, Date.now(), (s) => {
          if (s.phase.name !== 'KIDS_ROUND' || s.currentIndex !== questionIndexAtAnswer) return s;
          return applyJudgment(s, judged.playerId, judged);
        });
        return NextResponse.json(toPublicGameState(final, questions, Date.now(), mockAi));
      }

      const recordedAudio = transcript.trim().length > 0;
      if (recordedAudio) {
        const result = await judgeAnswer({
          question: question.question,
          title: question.title,
          author: question.author,
          transcript,
        });
        judged = {
          playerId,
          transcript,
          titleCorrect: result.titleCorrect,
          authorCorrect: result.authorCorrect,
          recorded: !result.needsReview,
          needsReview: result.needsReview,
        };
      } else {
        judged = { playerId, transcript: '', titleCorrect: false, authorCorrect: false, recorded: false };
      }
    }

    const final = await updateGame(code, questions, Date.now(), (s) => {
      // The question may have moved on while judging ran; don't apply a
      // stale judgment to the wrong question.
      if (s.phase.name !== 'KIDS_ROUND' || s.currentIndex !== questionIndexAtAnswer) return s;
      return applyJudgment(s, judged.playerId, judged);
    });
    return NextResponse.json(toPublicGameState(final, questions, Date.now(), mockAi));
  } catch (err) {
    if (err instanceof GameNotFoundError) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }
    throw err;
  }
}
