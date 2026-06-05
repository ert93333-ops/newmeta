import { afterEach, describe, expect, it, vi } from "vitest";
import { approveRequest, createApprovalRequest } from "@/lib/approval/approval-policy";
import { MetaGraphApiAdapter } from "@/lib/meta/graph-meta-adapter";

class TestableMetaGraphApiAdapter extends MetaGraphApiAdapter {
  getForTest<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    return this.graphGet<T>(path, params);
  }

  postForTest<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.graphPost<T>(path, body);
  }
}

const requester = {
  userId: "requester",
  tenantId: "tenant_1",
  role: "marketer" as const
};

const approver = {
  userId: "approver",
  tenantId: "tenant_1",
  role: "owner" as const
};

describe("MetaGraphApiAdapter token handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends Graph API GET tokens through Authorization headers, not URL query params", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new TestableMetaGraphApiAdapter("server-token", "v24.0");
    await adapter.getForTest("me/adaccounts", { fields: "id,name" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url.toString()).toBe("https://graph.facebook.com/v24.0/me/adaccounts?fields=id%2Cname");
    expect(url.searchParams.has("access_token")).toBe(false);
    expect(headers.authorization).toBe("Bearer server-token");
  });

  it("sends Graph API POST tokens through Authorization headers, not URL query params", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "creative-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new TestableMetaGraphApiAdapter("server-token", "v24.0");
    await adapter.postForTest("act_123/adcreatives", { name: "Paused creative" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url.toString()).toBe("https://graph.facebook.com/v24.0/act_123/adcreatives");
    expect(url.searchParams.has("access_token")).toBe(false);
    expect(headers.authorization).toBe("Bearer server-token");
    expect(init.body).toBeInstanceOf(URLSearchParams);
    expect((init.body as URLSearchParams).toString()).toBe("name=Paused+creative");
  });

  it("blocks credential-shaped query params before calling Meta", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new TestableMetaGraphApiAdapter("server-token", "v24.0");

    await expect(adapter.getForTest("me/adaccounts", { access_token: "leak" })).rejects.toThrow(
      "Credential-shaped fields are not accepted in API payloads."
    );
    await expect(adapter.getForTest("me/adaccounts?access_token=leak")).rejects.toThrow(
      "Credential-shaped fields are not accepted in API payloads."
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks credential-shaped POST body fields before calling Meta", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "creative-1" }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new TestableMetaGraphApiAdapter("server-token", "v24.0");

    await expect(adapter.postForTest("act_123/adcreatives", { access_token: "leak" })).rejects.toThrow(
      "Credential-shaped fields are not accepted in API payloads."
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not include token values in Graph API failure errors", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: "server-token should not be surfaced" } }), {
          status: 400
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new TestableMetaGraphApiAdapter("server-token", "v24.0");

    await expect(adapter.getForTest("me/adaccounts")).rejects.toThrow("META_GRAPH_REQUEST_FAILED:400");
    await expect(adapter.getForTest("me/adaccounts")).rejects.not.toThrow("server-token");
  });

  it("serializes live creative payloads as form data while keeping nested values intact", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "creative-live-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new MetaGraphApiAdapter("server-token", "v24.0");
    const approval = approveRequest(
      createApprovalRequest({
        context: requester,
        action: "meta_create_ad_paused",
        objectType: "ad_draft"
      }),
      approver
    );
    await adapter.createCreative({
      adAccountId: "act_123",
      name: "Live creative",
      pageId: "page_123",
      linkUrl: "https://example.com/products/test",
      imageHash: "hash_123",
      message: "Primary text",
      headline: "Hook",
      description: "Description",
      callToActionType: "SHOP_NOW",
      approval
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    const form = init.body as URLSearchParams;

    expect(url.toString()).toBe("https://graph.facebook.com/v24.0/act_123/adcreatives");
    expect(form.get("name")).toBe("Live creative");
    expect(form.get("object_story_spec")).toContain("\"page_id\":\"page_123\"");
    expect(form.get("object_story_spec")).toContain("\"image_hash\":\"hash_123\"");
    expect(form.get("object_story_spec")).toContain("\"type\":\"SHOP_NOW\"");
  });

  it("blocks live offsite-conversion ad sets without promotedObject before calling Meta", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "adset-live-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new MetaGraphApiAdapter("server-token", "v24.0");
    const approval = approveRequest(
      createApprovalRequest({
        context: requester,
        action: "meta_create_ad_paused",
        objectType: "ad_draft"
      }),
      approver
    );

    await expect(
      adapter.createAdSetPaused({
        adAccountId: "act_123",
        campaignId: "cmp_123",
        name: "Live adset",
        objective: "OUTCOME_SALES",
        optimizationGoal: "OFFSITE_CONVERSIONS",
        targeting: {
          geo_locations: {
            countries: ["KR"]
          }
        },
        approval
      })
    ).rejects.toThrow("META_PROMOTED_OBJECT_REQUIRED");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks live ad sets with empty targeting before calling Meta", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "adset-live-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new MetaGraphApiAdapter("server-token", "v24.0");
    const approval = approveRequest(
      createApprovalRequest({
        context: requester,
        action: "meta_create_ad_paused",
        objectType: "ad_draft"
      }),
      approver
    );

    await expect(
      adapter.createAdSetPaused({
        adAccountId: "act_123",
        campaignId: "cmp_123",
        name: "Live adset",
        objective: "OUTCOME_SALES",
        optimizationGoal: "OFFSITE_CONVERSIONS",
        targeting: {},
        promotedObject: {
          pixel_id: "pixel_123",
          custom_event_type: "PURCHASE"
        },
        approval
      })
    ).rejects.toThrow("META_TARGETING_REQUIRED");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
