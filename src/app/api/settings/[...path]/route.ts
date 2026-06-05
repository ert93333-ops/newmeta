import { resolveUserContext } from "@/lib/api/context";
import { fail, handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { getRepository } from "@/lib/repositories/hermes-repository";
import { assertRole } from "@/lib/security/rbac";

export async function PATCH(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const context = await resolveUserContext(request);
    const { path } = await params;
    const body = await parseWriteJson(request);

    if (path.some((segment) => segment.toLowerCase().includes("budget"))) {
      return fail("BUDGET_MUTATION_HARD_BLOCKED", "Budget mutation settings are not available.", 403);
    }

    assertRole(context, "marketer");

    const provider = path.join("/");
    const repository = getRepository();
    const existing = await repository.getIntegrationSettings(request, context, provider);
    const setting = await repository.saveIntegrationSettings(request, {
      id: existing?.id,
      tenantId: context.tenantId,
      createdBy: existing?.createdBy ?? context.userId,
      provider,
      settingsJson: body,
      createdAt: existing?.createdAt,
      updatedAt: existing?.updatedAt
    });

    await repository.saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: `settings_updated:${provider}`,
      objectType: "integration_settings",
      objectId: setting.id,
      beforeJson: existing?.settingsJson,
      afterJson: setting.settingsJson,
      result: "persisted"
    });

    return ok({
      status: "saved",
      path,
      provider,
      setting
    });
  } catch (error) {
    return handleError(error);
  }
}
