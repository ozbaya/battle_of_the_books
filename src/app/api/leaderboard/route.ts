import { NextResponse } from 'next/server';
import { buildLeaderboard } from '@/lib/leaderboard';
import { listUsage } from '@/lib/store';

// Generous enough to cover a family's full recent history for an accurate
// lifetime total; still a single cheap read, not per-player.
const SESSIONS_LIMIT = 500;

/** Public, unauthenticated — the home page leaderboard. */
export async function GET() {
  const sessions = await listUsage(SESSIONS_LIMIT);
  const leaderboard = buildLeaderboard(sessions, Date.now());
  return NextResponse.json({ leaderboard });
}
