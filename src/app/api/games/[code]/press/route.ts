import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { applyPress } from '@/lib/game/engine';
import { getQuestions } from '@/lib/questions';
import { GameNotFoundError, updateGame } from '@/lib/store';

const bodySchema = z.object({ playerId: z.string().min(1) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const questions = getQuestions();
  let accepted = false;
  let isFirstRespondent = false;
  try {
    await updateGame(code, questions, Date.now(), (s, n) => {
      const result = applyPress(s, parsed.data.playerId, n);
      accepted = result.accepted;
      isFirstRespondent = result.isFirstRespondent;
      return result.state;
    });
  } catch (err) {
    if (err instanceof GameNotFoundError) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }
    throw err;
  }

  return NextResponse.json({ accepted, isFirstRespondent });
}
