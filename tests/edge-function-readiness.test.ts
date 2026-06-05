import { describe, expect, it } from "vitest";
import { evaluateHermesEdgeFunction } from "@/lib/ops/edge-function-readiness";

describe("Hermes Edge Function readiness", () => {
  it("requires a bearer token before returning any edge-function metadata", () => {
    const result = evaluateHermesEdgeFunction({ authorization: undefined });

    expect(result).toEqual({
      status: 401,
      body: {
        error: "AUTH_REQUIRED"
      }
    });
  });

  it("fails closed for authenticated calls because no live edge handler is configured", () => {
    const result = evaluateHermesEdgeFunction({ authorization: "Bearer test-token" });

    expect(result.status).toBe(501);
    expect(result.body).toMatchObject({
      error: "EDGE_FUNCTION_NOT_CONFIGURED",
      runtime: "supabase-edge-function"
    });
  });
});
