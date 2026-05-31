import type { ApprovalRequest, UserContext } from "@/lib/types";

interface HermesStore {
  approvals: Map<string, ApprovalRequest>;
  jobs: Map<string, unknown>;
  assets: Map<string, unknown>;
  costUsage: unknown[];
}

const globalStore = globalThis as typeof globalThis & { __hermesStore?: HermesStore };

export function getStore(): HermesStore {
  if (!globalStore.__hermesStore) {
    globalStore.__hermesStore = {
      approvals: new Map(),
      jobs: new Map(),
      assets: new Map(),
      costUsage: []
    };
  }
  return globalStore.__hermesStore;
}

export function mockContext(): UserContext {
  return {
    userId: "00000000-0000-0000-0000-000000000010",
    tenantId: process.env.HERMES_DEFAULT_TENANT_ID ?? "00000000-0000-0000-0000-000000000001",
    role: "owner",
    email: "owner@example.com"
  };
}
