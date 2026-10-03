import { Redis } from '@upstash/redis';
import type { GameState } from '../game/types';
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

function readEnv(primary: string, fallback: string): { url: string; token: string } {
  const url = process.env[primary + '_URL'] ?? process.env[fallback + '_URL'];
  const token = process.env[primary + '_TOKEN'] ?? process.env[fallback + '_TOKEN'];
  if (!url || !token) {
    throw new Error(
      `Redis store selected but neither ${primary}_URL/${primary}_TOKEN nor ${fallback}_URL/${fallback}_TOKEN are set`
    );
  }
  return { url, token };
}

let client: Redis | null = null;
function getClient(): Redis {
  if (!client) {
    const { url, token } = readEnv('UPSTASH_REDIS_REST', 'KV_REST_API');
    client = new Redis({ url, token });
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
};
