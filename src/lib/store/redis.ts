import { Redis } from '@upstash/redis';
import type { GameState } from '../game/types';
import type { UsageSession } from '../usage';
import type { Store } from './types';

// Games expire from Redis after 24h; the TTL is refreshed on every write so a
// long-running game started near the boundary never expires mid-play.
const GAME_TTL_SECONDS = 60 * 60 * 24;

function key(code: string): string {
  return `game:${code}`;
}

// Sorted set of every game code ever created, scored by creation time, so
// the home page / admin lists can enumerate games without a full key scan.
// Entries aren't removed when a game's own key expires (TTL only applies to
// the `game:*` key) — listCodes()'s callers are expected to drop any code
// whose load() comes back null, and forgetCode() lazily prunes it here too.
const INDEX_KEY = 'games:index';

// Capped list of completed sessions for the admin "usage" view, oldest
// entries dropped past USAGE_LOG_CAP. No TTL — unlike game state (whose 24h
// expiry bounds storage of stale games), this is meant to persist, since
// its whole purpose is historical visibility.
const USAGE_KEY = 'usage:sessions';
const USAGE_LOG_CAP = 500;

// Vercel Storage integrations (e.g. connecting an Upstash Redis database
// from the Marketplace) prefix every injected env var with whatever name you
// gave the database — e.g. naming it "bob" yields BOB_KV_REST_API_URL /
// BOB_KV_REST_API_TOKEN, not the unprefixed names. Rather than guess a
// prefix, scan for any matching URL/TOKEN pair with a shared prefix.
const URL_SUFFIXES = ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL'];

export function findRedisCredentials(): { url: string; token: string } | null {
  const env = process.env;
  for (const suffix of URL_SUFFIXES) {
    // Unprefixed first (the common case when connecting directly to Upstash).
    const tokenSuffix = suffix.replace('_URL', '_TOKEN');
    if (env[suffix] && env[tokenSuffix]) {
      return { url: env[suffix]!, token: env[tokenSuffix]! };
    }
    for (const key of Object.keys(env)) {
      if (key === suffix || !key.endsWith(`_${suffix}`)) continue;
      const prefix = key.slice(0, -suffix.length - 1);
      const tokenKey = `${prefix}_${tokenSuffix}`;
      if (env[key] && env[tokenKey]) {
        return { url: env[key]!, token: env[tokenKey]! };
      }
    }
  }
  return null;
}

let client: Redis | null = null;
function getClient(): Redis {
  if (!client) {
    const credentials = findRedisCredentials();
    if (!credentials) {
      throw new Error('Redis store selected but no *_KV_REST_API_URL/_TOKEN or *_UPSTASH_REDIS_REST_URL/_TOKEN env vars were found');
    }
    client = new Redis(credentials);
  }
  return client;
}

// KEYS[1] = game key, ARGV[1] = expected version, ARGV[2] = new state JSON, ARGV[3] = ttl seconds.
// Atomic: Redis executes the whole script single-threaded, so this is a real
// compare-and-swap even though the client issues GET then conditional SET.
const CAS_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current == false then return 0 end
local decoded = cjson.decode(current)
if tostring(decoded.version) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
`;

export const redisStore: Store = {
  async load(code) {
    const raw = await getClient().get<GameState>(key(code));
    return raw ?? null;
  },

  async create(code, state) {
    await Promise.all([
      getClient().set(key(code), state, { ex: GAME_TTL_SECONDS }),
      getClient().zadd(INDEX_KEY, { score: state.createdAt, member: code }),
    ]);
  },

  async casSave(code, expectedVersion, nextState) {
    const result = await getClient().eval<string[], number>(
      CAS_SCRIPT,
      [key(code)],
      [String(expectedVersion), JSON.stringify(nextState), String(GAME_TTL_SECONDS)]
    );
    return result === 1;
  },

  async listCodes(limit) {
    return getClient().zrange<string[]>(INDEX_KEY, 0, limit - 1, { rev: true });
  },

  async forgetCode(code) {
    await getClient().zrem(INDEX_KEY, code);
  },

  async delete(code) {
    await Promise.all([getClient().del(key(code)), getClient().zrem(INDEX_KEY, code)]);
  },

  async logUsage(session) {
    await getClient().lpush(USAGE_KEY, session);
    await getClient().ltrim(USAGE_KEY, 0, USAGE_LOG_CAP - 1);
  },

  async listUsage(limit) {
    return getClient().lrange<UsageSession>(USAGE_KEY, 0, limit - 1);
  },
};
