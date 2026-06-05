import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getTenant } from "@/app/api/tenants/[id]/route";
import type { IdentityContext } from "@/lib/api/context";

const { mockResolveIdentityContext } = vi.hoisted(() => ({
  mockResolveIdentityContext: vi.fn()
}));

vi.mock("@/lib/api/context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/context")>("@/lib/api/context");
  return {
    ...actual,
    resolveIdentityContext: mockResolveIdentityContext
  };
});

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

const identity: IdentityContext = {
  userId: "tenant-route-user",
  email: "owner@example.com",
  memberships: [
    {
      tenantId: "tenant-alpha",
      name: "Tenant Alpha",
      role: "admin",
      isInternal: false,
      crossTenantLearningOptIn: true
    },
    {
      tenantId: "tenant-beta",
      name: "Tenant Beta",
      role: "viewer",
      isInternal: true,
      crossTenantLearningOptIn: false
    }
  ]
};

describe("tenant route", () => {
  afterEach(() => {
    mockResolveIdentityContext.mockReset();
  });

  it("returns membership-scoped tenant metadata from the identity bootstrap context", async () => {
    mockResolveIdentityContext.mockResolvedValue(identity);

    const response = await getTenant(new Request("http://localhost/api/tenants/tenant-alpha"), params("tenant-alpha"));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      tenant: {
        id: "tenant-alpha",
        name: "Tenant Alpha",
        role: "admin",
        isInternal: false,
        crossTenantLearningOptIn: true
      }
    });
  });

  it("denies access when the requested tenant is not in the caller memberships", async () => {
    mockResolveIdentityContext.mockResolvedValue(identity);

    const response = await getTenant(new Request("http://localhost/api/tenants/tenant-gamma"), params("tenant-gamma"));
    const body = await json(response);

    expect(response.status).toBe(403);
    expect((body.error as { code?: string }).code).toBe("TENANT_ACCESS_DENIED");
  });
});
