import { describe, expect, it } from "vitest";
import { resolveUserContext } from "@/lib/api/context";

describe("API context", () => {
  it("uses mock context when Supabase env is not configured", async () => {
    const context = await resolveUserContext(new Request("http://localhost/api/me"));
    expect(context.role).toBe("owner");
    expect(context.tenantId).toBeTruthy();
  });
});
