import { handleError, ok } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { readCommerceDbReadiness } from "@/lib/integrations/commerce-db-readiness";
import { getRepository } from "@/lib/repositories/hermes-repository";

export async function GET(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const setting = await getRepository().getIntegrationSettings(request, context, "commerce-db");

    return ok({
      provider: "commerce-db",
      configured: Boolean(setting),
      readiness: readCommerceDbReadiness(setting?.settingsJson)
    });
  } catch (error) {
    return handleError(error);
  }
}
