import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ADMIN_COOKIE_NAME, adminCookieOptions, adminCookieValue, checkAdminPassword } from '@/lib/admin-auth';

const bodySchema = z.object({ password: z.string().min(1) });

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (!checkAdminPassword(parsed.data.password)) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE_NAME, adminCookieValue(), adminCookieOptions);
  return response;
}
