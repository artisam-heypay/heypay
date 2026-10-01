import "server-only";
import { redis } from "@/server/redis";
import { tooManyRequests } from "@/lib/errors";

// Atomic token-bucket: refill by elapsed time, consume one token, persist, set TTL.
// KEYS[1]=bucket  ARGV[1]=capacity  ARGV[2]=windowSec  ARGV[3]=nowMs
// Returns 1 if a token was consumed, 0 if the bucket was empty.
const BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local rate = capacity / window
local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then
  tokens = capacity
  ts = now
end
local elapsed = (now - ts) / 1000
tokens = math.min(capacity, tokens + elapsed * rate)
ts = now
local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end
redis.call('HSET', key, 'tokens', tokens, 'ts', ts)
redis.call('PEXPIRE', key, math.ceil(window * 1000))
return allowed
`;

export async function rateLimit(
  key: string,
  opts: { limit: number; windowSec: number },
): Promise<void> {
  const allowed = await redis.eval(
    BUCKET_SCRIPT,
    1,
    key,
    String(opts.limit),
    String(opts.windowSec),
    String(Date.now()),
  );
  if (Number(allowed) !== 1) {
    throw tooManyRequests("Too many requests. Please try again later.");
  }
}
