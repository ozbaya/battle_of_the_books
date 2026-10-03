import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { logUsage } from '@/lib/store';
import { logUsageBodySchema } from '@/lib/usage';

/**
 * Public, fire-and-forget: /practice and /quiz call this once when a round
 * ends (natural completion or an early "Finish round"), so the admin's
 * usage view has something to show for modes that otherwise keep zero
 * server-side state. Never blocks or fails the round itself on the client
 * side — callers should not await-and-surface errors from this.
 */
export async function POST(request: NextRequest) {
  const json = await request.json().catch(() => null);
  const parsed = logUsageBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const name = parsed.data.name?.trim() || 'Anonymous';
  await logUsage({
    id: nanoid(),
    mode: parsed.data.mode,
    name,
    endedAt: Date.now(),
    totalQuestions: parsed.data.totalQuestions,
    correct: parsed.data.correct,
    titleOnly: parsed.data.titleOnly,
    wrong: parsed.data.wrong,
    noAnswer: parsed.data.noAnswer,
    score: parsed.data.score,
  });

  return NextResponse.json({ ok: true });
}
