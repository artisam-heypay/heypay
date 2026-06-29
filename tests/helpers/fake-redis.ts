// Minimal in-memory ioredis stand-in supporting the commands used by the auth layer:
// get/set/del/incr/expire and eval (token-bucket script emulation).
export function makeFakeRedis() {
  const kv = new Map<string, string>();
  const buckets = new Map<string, { tokens: number; ts: number }>();

  return {
    async get(k: string) {
      return kv.get(k) ?? null;
    },
    async set(k: string, v: string, ..._rest: unknown[]) {
      kv.set(k, v);
      return "OK";
    },
    async del(k: string) {
      return kv.delete(k) ? 1 : 0;
    },
    async incr(k: string) {
      const n = Number(kv.get(k) ?? "0") + 1;
      kv.set(k, String(n));
      return n;
    },
    async expire() {
      return 1;
    },
    // Emulates the token-bucket Lua script: eval(script, numKeys, key, limit, windowSec, nowMs)
    async eval(
      _script: string,
      _numKeys: number,
      key: string,
      limit: string,
      win: string,
      now: string,
    ) {
      const capacity = Number(limit);
      const window = Number(win);
      const t = Number(now);
      const rate = capacity / window;
      const b = buckets.get(key) ?? { tokens: capacity, ts: t };
      const elapsed = (t - b.ts) / 1000;
      let tokens = Math.min(capacity, b.tokens + elapsed * rate);
      let allowed = 0;
      if (tokens >= 1) {
        tokens -= 1;
        allowed = 1;
      }
      buckets.set(key, { tokens, ts: t });
      return allowed;
    },
    _reset() {
      kv.clear();
      buckets.clear();
    },
  };
}
