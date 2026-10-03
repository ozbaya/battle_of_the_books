import { NextRequest, NextResponse } from 'next/server';
import { getQuestions, type QuestionSet } from '@/lib/questions';

/**
 * Public, stateless — no game, no store, no Redis. Answers are stripped;
 * only the question text and its bank index go to the client. Always
 * reports hardAvailable (hard.md has at least one row) regardless of which
 * set was requested, so the client knows whether to offer the "Hard"
 * option at all, in the same call.
 */
export async function GET(request: NextRequest) {
  const set: QuestionSet = request.nextUrl.searchParams.get('set') === 'hard' ? 'hard' : 'standard';
  const questions = getQuestions(set);
  const hardAvailable = set === 'hard' ? questions.length > 0 : getQuestions('hard').length > 0;
  return NextResponse.json({
    questions: questions.map((q, index) => ({ index, question: q.question })),
    hardAvailable,
    mockAi: process.env.MOCK_AI === 'true',
  });
}
