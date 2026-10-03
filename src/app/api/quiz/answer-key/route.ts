import { NextRequest, NextResponse } from 'next/server';
import { getQuizBank } from '@/lib/quiz';

/**
 * Public, stateless lookup for the "Show me the answer" give-up button,
 * mirroring /api/practice/answer-key. No transcribe/judge call — just a
 * direct lookup, since there's nothing to score.
 */
export async function GET(request: NextRequest) {
  const indexRaw = request.nextUrl.searchParams.get('index');
  const index = indexRaw === null ? NaN : Number(indexRaw);
  const bank = getQuizBank();
  if (!Number.isInteger(index) || index < 0 || index >= bank.length) {
    return NextResponse.json({ error: 'Invalid index' }, { status: 400 });
  }
  const entry = bank[index];
  return NextResponse.json({ correctAnswer: entry.kind === 'title' ? entry.title : entry.author });
}
