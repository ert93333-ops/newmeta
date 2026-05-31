import type { MetaAdapter } from "@/lib/meta/meta-adapter";
import { MockMetaAdapter } from "@/lib/meta/mock-meta-adapter";

export class MetaMcpAdapter extends MockMetaAdapter implements MetaAdapter {
  readonly mode = "mcp-placeholder";
}
