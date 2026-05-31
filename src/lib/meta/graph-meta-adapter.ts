import { assertNoBudgetMutation } from "@/lib/guards/budget-guard";
import type { MetaAdapter } from "@/lib/meta/meta-adapter";
import { MockMetaAdapter } from "@/lib/meta/mock-meta-adapter";

export class MetaGraphApiAdapter extends MockMetaAdapter implements MetaAdapter {
  constructor(
    private readonly accessToken: string,
    private readonly graphVersion = process.env.META_GRAPH_VERSION ?? "v24.0"
  ) {
    super();
  }

  protected async graphGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(`https://graph.facebook.com/${this.graphVersion}/${path.replace(/^\//, "")}`);
    url.searchParams.set("access_token", this.accessToken);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`META_GRAPH_REQUEST_FAILED:${response.status}`);
    }
    return (await response.json()) as T;
  }

  protected async graphPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
    assertNoBudgetMutation(body);
    const url = new URL(`https://graph.facebook.com/${this.graphVersion}/${path.replace(/^\//, "")}`);
    url.searchParams.set("access_token", this.accessToken);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`META_GRAPH_REQUEST_FAILED:${response.status}`);
    }
    return (await response.json()) as T;
  }
}
