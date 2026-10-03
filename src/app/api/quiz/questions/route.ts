import { NextResponse } from 'next/server';
import { getQuizBank } from '@/lib/quiz';

/**
 * Public, stateless — no game, no store, no Redis, same shape as
 * /api/practice/questions. Only the prompt text and bank index go to the
 * client; the expected title/author stays server-side.
 */
export async function GET() {
  const bank = getQuizBank();
  return NextResponse.json({
    questions: bank.map(({ index, prompt }) => ({ index, prompt })),
    mockAi: process.env.MOCK_AI === 'true',
  });
}
