import { assertNoBudgetMutation } from "@/lib/guards/budget-guard";
import { assertNoCredentialPayload } from "@/lib/guards/credential-guard";
import type { MetaAdapter } from "@/lib/meta/meta-adapter";
import { MockMetaAdapter } from "@/lib/meta/mock-meta-adapter";

export class MetaGraphApiAdapter extends MockMetaAdapter implements MetaAdapter {
  private readonly accessToken: string;
  private readonly graphVersion: string;

  constructor(
    accessToken: string,
    graphVersion = process.env.META_GRAPH_VERSION ?? "v24.0"
  ) {
    super();
    this.accessToken = accessToken.trim();
    this.graphVersion = graphVersion;
    if (!this.accessToken) {
      throw new Error("META_ACCESS_TOKEN_REQUIRED");
    }
  }

  protected async graphGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = this.graphUrl(path);
    assertNoCredentialPayload(params);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetch(url, {
      headers: this.authorizationHeaders(),
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`META_GRAPH_REQUEST_FAILED:${response.status}`);
    }
    return (await response.json()) as T;
  }

  protected async graphPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
    assertNoBudgetMutation(body);
    assertNoCredentialPayload(body);
    const url = this.graphUrl(path);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...this.authorizationHeaders(),
        "content-type": "application/json"
      },
      cache: "no-store",
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`META_GRAPH_REQUEST_FAILED:${response.status}`);
    }
    return (await response.json()) as T;
  }

  private graphUrl(path: string): URL {
    const url = new URL(`https://graph.facebook.com/${this.graphVersion}/${path.replace(/^\//, "")}`);
    assertNoCredentialPayload(Object.fromEntries(url.searchParams.entries()));
    return url;
  }

  private authorizationHeaders(): Record<string, string> {
    return {
      authorization: `Bearer ${this.accessToken}`
    };
  }
}
