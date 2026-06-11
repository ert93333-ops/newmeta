import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getCommerceDbStatus } from "@/app/api/integrations/commerce-db/status/route";
import { MemoryHermesRepository } from "@/lib/repositories/hermes-repository";
import type { UserContext } from "@/lib/types";

const { mockResolveUserContext } = vi.hoisted(() => ({
  mockResolveUserContext: vi.fn()
}));

vi.mock("@/lib/api/context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/context")>("@/lib/api/context");
  return {
    ...actual,
    resolveUserContext: mockResolveUserContext
  };
});

const context: UserContext = {
  userId: "commerce-user",
  tenantId: "tenant-commerce",
  role: "marketer"
};

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("commerce DB status route", () => {
  afterEach(() => {
    mockResolveUserContext.mockReset();
    delete (globalThis as typeof globalThis & { __hermesRepositoryStore?: unknown }).__hermesRepositoryStore;
  });

  it("reports not configured without tenant commerce settings", async () => {
    mockResolveUserContext.mockResolvedValue(context);

    const response = await getCommerceDbStatus(new Request("http://localhost/api/integrations/commerce-db/status"));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      provider: "commerce-db",
      configured: false,
      readiness: {
        status: "not_configured",
        connectionConfigured: false,
        missing: ["sourceType", "connectionConfigured", "tables.orders", "tables.customers", "tables.products"]
      }
    });
  });

  it("reports configured commerce DB readiness without exposing secrets", async () => {
    mockResolveUserContext.mockResolvedValue(context);
    await new MemoryHermesRepository().saveIntegrationSettings(new Request("http://localhost/api/test"), {
      tenantId: context.tenantId,
      createdBy: context.userId,
      provider: "commerce-db",
      settingsJson: {
        sourceType: "postgres",
        connectionConfigured: true,
        connectionStringSecretRef: "secret://commerce-db-url",
        tables: {
          orders: "shop_orders",
          customers: "shop_customers",
          products: "shop_products"
        }
      }
    });

    const response = await getCommerceDbStatus(new Request("http://localhost/api/integrations/commerce-db/status"));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      configured: true,
      readiness: {
        status: "configured",
        sourceType: "postgres",
        connectionConfigured: true,
        tables: {
          orders: "shop_orders",
          customers: "shop_customers",
          products: "shop_products"
        },
        missing: []
      }
    });
    expect(JSON.stringify(body)).not.toMatch(/connectionString|secret:\/\/commerce-db-url/i);
  });
});
