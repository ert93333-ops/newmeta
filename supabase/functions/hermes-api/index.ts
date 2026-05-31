import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve((request) => {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return Response.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  return Response.json({
    ok: true,
    runtime: "supabase-edge-function",
    note: "Next.js API routes are primary; Edge Functions can host worker/webhook endpoints."
  });
});
