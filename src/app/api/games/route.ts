import { NextResponse } from 'next/server';
import { listActiveGames } from '@/lib/store';

/** Public (no admin auth) — powers the home page's "join a game" list. */
export async function GET() {
  const games = await listActiveGames();
  return NextResponse.json({
    games: games.map((g) => ({
      code: g.code,
      teamName: g.teamName,
      playerCount: Object.keys(g.players).length,
      phase: g.phase.name,
    })),
  });
}
