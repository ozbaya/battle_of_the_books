import { NextRequest, NextResponse } from 'next/server';
import { getQuestions } from '@/lib/questions';

/**
 * Public, stateless lookup for the "Show me the answer" give-up button in
 * practice mode. Deliberately bypasses transcribe/judge entirely (there's no
 * audio and nothing to score) — just reveals the correct title/author for a
 * question the player chose not to attempt.
 */
export async function GET(request: NextRequest) {
  const indexRaw = request.nextUrl.searchParams.get('index');
  const index = indexRaw === null ? NaN : Number(indexRaw);
  const questions = getQuestions();
  if (!Number.isInteger(index) || index < 0 || index >= questions.length) {
    return NextResponse.json({ error: 'Invalid index' }, { status: 400 });
  }
  const question = questions[index];
  return NextResponse.json({ correctTitle: question.title, correctAuthor: question.author });
}
