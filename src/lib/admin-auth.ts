import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';

export const ADMIN_COOKIE_NAME = 'botb_admin';
const ADMIN_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * The cookie proves knowledge of ADMIN_PASSWORD without ever storing the
 * password itself client-side: it's an HMAC keyed by the password, so only
 * someone who already knows ADMIN_PASSWORD can produce it. No separate
 * session secret env var exists (CLAUDE.md §9 only defines ADMIN_PASSWORD).
 */
function expectedAdminToken(): string {
  const secret = process.env.ADMIN_PASSWORD ?? '';
  return crypto.createHmac('sha256', secret).update('botb-admin-session').digest('hex');
}

export function checkAdminPassword(submitted: string): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? '';
  if (!expected) return false;
  return timingSafeEqualStrings(submitted, expected);
}

export function adminCookieValue(): string {
  return expectedAdminToken();
}

export const adminCookieOptions = {
  httpOnly: true as const,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: ADMIN_COOKIE_MAX_AGE_SECONDS,
};

export function isAuthorizedAdmin(request: NextRequest): boolean {
  // Without a password the HMAC key would be '' and the token publicly computable.
  if (!process.env.ADMIN_PASSWORD) return false;
  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!token) return false;
  return timingSafeEqualStrings(token, expectedAdminToken());
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
