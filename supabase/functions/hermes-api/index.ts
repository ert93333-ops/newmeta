import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { evaluateHermesEdgeFunction } from "../../../src/lib/ops/edge-function-readiness.ts";

serve((request) => {
  const result = evaluateHermesEdgeFunction({
    authorization: request.headers.get("authorization")
  });
  return Response.json(result.body, { status: result.status });
});
