import { NextRequest, NextResponse } from 'next/server';
import { getQuestions, parseQuestionSet } from '@/lib/questions';

/**
 * Public, stateless — no game, no store, no Redis. Answers are stripped;
 * only the question text and its bank index go to the client. Always
 * reports hardAvailable/superDuperHardAvailable/rishiModeAvailable (their
 * files have at least one row) regardless of which set was requested, so the
 * client knows whether to offer those options at all, in the same call.
 */
export async function GET(request: NextRequest) {
  const set = parseQuestionSet(request.nextUrl.searchParams.get('set'));
  const questions = getQuestions(set);
  const hardAvailable = set === 'hard' ? questions.length > 0 : getQuestions('hard').length > 0;
  const superDuperHardAvailable =
    set === 'superDuperHard' ? questions.length > 0 : getQuestions('superDuperHard').length > 0;
  const rishiModeAvailable =
    set === 'rishiMode' ? questions.length > 0 : getQuestions('rishiMode').length > 0;
  return NextResponse.json({
    questions: questions.map((q, index) => ({ index, question: q.question })),
    hardAvailable,
    superDuperHardAvailable,
    rishiModeAvailable,
    mockAi: process.env.MOCK_AI === 'true',
  });
}
