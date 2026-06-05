export interface EdgeFunctionHandshakeResult {
  status: number;
  body: Record<string, unknown>;
}

export function evaluateHermesEdgeFunction(input: {
  authorization: string | null | undefined;
}): EdgeFunctionHandshakeResult {
  if (!input.authorization?.startsWith("Bearer ")) {
    return {
      status: 401,
      body: { error: "AUTH_REQUIRED" }
    };
  }

  return {
    status: 501,
    body: {
      error: "EDGE_FUNCTION_NOT_CONFIGURED",
      runtime: "supabase-edge-function",
      note: "Next.js API routes are primary. Deploy a dedicated worker/webhook handler before exposing this Edge Function path."
    }
  };
}
