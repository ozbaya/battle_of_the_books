import { NextResponse } from 'next/server';
import { toPublicGameState } from '@/lib/game/engine';
import { getQuestions } from '@/lib/questions';
import { GameNotFoundError, updateGame } from '@/lib/store';

/**
 * Polled by every screen (~every 500ms). The "action" here is the identity
 * function — the point of this request is just load -> advance -> save, so
 * lazy time-based transitions actually get persisted between polls even
 * though Vercel has no server timers (CLAUDE.md §4.1).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const questions = getQuestions();
  const now = Date.now();
  try {
    const state = await updateGame(code, questions, now, (s) => s);
    return NextResponse.json(toPublicGameState(state, questions, now, process.env.MOCK_AI === 'true'));
  } catch (err) {
    if (err instanceof GameNotFoundError) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }
    throw err;
  }
}
