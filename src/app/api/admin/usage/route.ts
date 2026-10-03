import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedAdmin } from '@/lib/admin-auth';
import { listUsage } from '@/lib/store';
import { aggregateUsageByName } from '@/lib/usage';

const SESSIONS_LIMIT = 200;

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sessions = await listUsage(SESSIONS_LIMIT);
  return NextResponse.json({
    sessions,
    totals: aggregateUsageByName(sessions),
  });
}
