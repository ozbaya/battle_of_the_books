import { nanoid } from 'nanoid';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { applyJoin } from '@/lib/game/engine';
import { GameNotFoundError, updateGame } from '@/lib/store';

const bodySchema = z.object({ name: z.string().trim().min(1).max(30) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
  }

  const playerId = nanoid();
  try {
    await updateGame(code, Date.now(), (s) => applyJoin(s, playerId, parsed.data.name));
  } catch (err) {
    if (err instanceof GameNotFoundError) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }
    throw err;
  }

  return NextResponse.json({ playerId });
}
