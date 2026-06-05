import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaGraphApiAdapter } from "@/lib/meta/graph-meta-adapter";

class TestableMetaGraphApiAdapter extends MetaGraphApiAdapter {
  getForTest<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    return this.graphGet<T>(path, params);
  }

  postForTest<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.graphPost<T>(path, body);
  }
}

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
    expect(init.body).toBe(JSON.stringify({ name: "Paused creative" }));
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
});
