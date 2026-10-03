import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthorizedAdmin } from '@/lib/admin-auth';
import { applyAdminOverride, applyEndGame, applyStart, toPublicGameState } from '@/lib/game/engine';
import { getQuestions } from '@/lib/questions';
import { GameNotFoundError, updateGame } from '@/lib/store';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({ action: z.literal('end') }),
  z.object({
    action: z.literal('override'),
    historyIndex: z.number().int().min(0),
    bucket: z.enum(['full', 'titleOnly', 'wrong', 'none']),
  }),
]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { code } = await params;
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const questions = getQuestions();
  const now = Date.now();
  try {
    const state = await updateGame(code, questions, now, (s, n) => {
      switch (parsed.data.action) {
        case 'start':
          return applyStart(s, n);
        case 'end':
          return applyEndGame(s);
        case 'override':
          return applyAdminOverride(s, parsed.data.historyIndex, parsed.data.bucket);
      }
    });
    return NextResponse.json(toPublicGameState(state, questions, now, process.env.MOCK_AI === 'true'));
  } catch (err) {
    if (err instanceof GameNotFoundError) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }
    throw err;
  }
}
