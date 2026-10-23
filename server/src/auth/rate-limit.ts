export interface LoginRateLimiter {
  check(ip: string): boolean;
}

export function createLoginRateLimiter(limit = 5, windowMs = 60_000): LoginRateLimiter {
  const attempts = new Map<string, number[]>();
  return {
    check(ip: string): boolean {
      const now = Date.now();
      const cutoff = now - windowMs;
      const list = (attempts.get(ip) ?? []).filter((timestamp) => timestamp > cutoff);
      if (list.length >= limit) {
        attempts.set(ip, list);
        return false;
      }
      list.push(now);
      attempts.set(ip, list);
      return true;
    },
  };
}
