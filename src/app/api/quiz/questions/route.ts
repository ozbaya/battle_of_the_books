import { NextRequest, NextResponse } from 'next/server';
import type { QuestionSet } from '@/lib/questions';
import { getQuizBank } from '@/lib/quiz';

/**
 * Public, stateless — no game, no store, no Redis, same shape as
 * /api/practice/questions. Only the prompt text and bank index go to the
 * client; the expected title/author stays server-side. Always reports
 * hardAvailable regardless of which set was requested, so the client knows
 * whether to offer the "Hard" option at all, in the same call.
 */
export async function GET(request: NextRequest) {
  const set: QuestionSet = request.nextUrl.searchParams.get('set') === 'hard' ? 'hard' : 'standard';
  const bank = getQuizBank(set);
  const hardAvailable = set === 'hard' ? bank.length > 0 : getQuizBank('hard').length > 0;
  return NextResponse.json({
    questions: bank.map(({ index, prompt }) => ({ index, prompt })),
    hardAvailable,
    mockAi: process.env.MOCK_AI === 'true',
  });
}
