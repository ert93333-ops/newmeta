import { afterEach, describe, expect, it } from "vitest";
import { handleError } from "@/lib/api/responses";
import { assertRateLimit, resetRateLimits } from "@/lib/security/rate-limit";

function request(ip = "203.0.113.10"): Request {
  return new Request("http://localhost/api/test", {
    headers: {
      "x-forwarded-for": ip,
      "user-agent": "vitest"
    }
  });
}

describe("rate limit guard", () => {
  afterEach(() => {
    resetRateLimits();
  });

  it("blocks requests after the window limit for the same client key", () => {
    assertRateLimit(request(), { keyPrefix: "test", limit: 2, windowMs: 60_000 });
    assertRateLimit(request(), { keyPrefix: "test", limit: 2, windowMs: 60_000 });

    expect(() => assertRateLimit(request(), { keyPrefix: "test", limit: 2, windowMs: 60_000 })).toThrow("RATE_LIMITED");
  });

  it("maps rate limit errors to a 429 API response", async () => {
    assertRateLimit(request(), { keyPrefix: "test", limit: 1, windowMs: 60_000 });

    let response: Response | undefined;
    try {
      assertRateLimit(request(), { keyPrefix: "test", limit: 1, windowMs: 60_000 });
    } catch (error) {
      response = handleError(error);
    }
    const body = (await response?.json()) as { error?: { code?: string; details?: { retryAfterSeconds?: number } } };

    expect(response?.status).toBe(429);
    expect(body.error?.code).toBe("RATE_LIMITED");
    expect(body.error?.details?.retryAfterSeconds).toEqual(expect.any(Number));
  });

  it("tracks different client keys independently", () => {
    assertRateLimit(request("203.0.113.11"), { keyPrefix: "test", limit: 1, windowMs: 60_000 });

    expect(() => assertRateLimit(request("203.0.113.12"), { keyPrefix: "test", limit: 1, windowMs: 60_000 })).not.toThrow();
  });
});
