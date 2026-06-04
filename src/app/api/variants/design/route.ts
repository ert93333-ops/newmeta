import { designVariants } from "@/lib/variants/variant-designer";
import { handleError, ok, parseWriteJson } from "@/lib/api/responses";
import type { VariantDesignInput } from "@/lib/variants/variant-designer";

export async function POST(request: Request) {
  try {
    return ok(designVariants((await parseWriteJson(request)) as VariantDesignInput), 201);
  } catch (error) {
    return handleError(error);
  }
}
