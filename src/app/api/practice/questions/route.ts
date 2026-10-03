import { NextResponse } from 'next/server';
import { getQuestions } from '@/lib/questions';

/**
 * Public, stateless — no game, no store, no Redis. Answers are stripped;
 * only the question text and its bank index go to the client.
 */
export async function GET() {
  const questions = getQuestions();
  return NextResponse.json({
    questions: questions.map((q, index) => ({ index, question: q.question })),
    mockAi: process.env.MOCK_AI === 'true',
  });
}
