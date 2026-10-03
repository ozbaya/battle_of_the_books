import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthorizedAdmin } from '@/lib/admin-auth';
import { DEFAULT_NUM_QUESTIONS } from '@/lib/game/config';
import { createGame } from '@/lib/game/engine';
import { generateGameCode } from '@/lib/game-code';
import { getQuestions } from '@/lib/questions';
import { getGame, insertGame, listRecentGames } from '@/lib/store';

const createSchema = z.object({
  teamName: z.string().trim().min(1).max(60),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  numQuestions: z.number().int().min(1).optional(),
});

export async function POST(request: NextRequest) {
  if (!isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const questions = getQuestions();
  const requested = parsed.data.numQuestions ?? Math.min(DEFAULT_NUM_QUESTIONS, questions.length);
  const numQuestions = Math.max(1, Math.min(requested, questions.length));

  let code = generateGameCode();
  while (await getGame(code)) {
    code = generateGameCode();
  }

  const state = createGame({
    code,
    teamName: parsed.data.teamName,
    difficulty: parsed.data.difficulty,
    numQuestions,
    totalQuestions: questions.length,
    seed: Math.floor(Math.random() * 2 ** 31),
    now: Date.now(),
    rng: Math.random,
  });

  await insertGame(code, state);

  return NextResponse.json({
    code,
    links: { play: `/play/${code}`, screen: `/screen/${code}`, scores: `/scores/${code}` },
  });
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const games = await listRecentGames();
  return NextResponse.json({
    games: games.map((g) => ({
      code: g.code,
      teamName: g.teamName,
      difficulty: g.difficulty,
      phase: g.phase.name,
      createdAt: g.createdAt,
    })),
  });
}
