export interface RateLimitOptions {
  keyPrefix: string;
  limit: number;
  windowMs: number;
}

export class RateLimitExceededError extends Error {
  readonly code = "RATE_LIMITED";

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    readonly retryAfterSeconds: number
  ) {
    super("RATE_LIMITED");
  }
}

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

export function assertRateLimit(request: Request, options: RateLimitOptions): void {
  const now = Date.now();
  const key = `${options.keyPrefix}:${clientKey(request)}`;
  const current = store.get(key);

  if (!current || current.resetAt <= now) {
    store.set(key, {
      count: 1,
      resetAt: now + options.windowMs
    });
    return;
  }

  if (current.count >= options.limit) {
    throw new RateLimitExceededError(options.limit, options.windowMs, Math.max(1, Math.ceil((current.resetAt - now) / 1000)));
  }

  current.count += 1;
}

export function resetRateLimits(): void {
  store.clear();
}

export function isRateLimitExceededError(error: unknown): error is RateLimitExceededError {
  return error instanceof RateLimitExceededError;
}

function clientKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const userAgent = request.headers.get("user-agent")?.trim();
  return [forwardedFor || realIp || "unknown-ip", userAgent || "unknown-agent"].join("|");
}
