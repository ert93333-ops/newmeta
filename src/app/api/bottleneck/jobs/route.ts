import { randomUUID } from "node:crypto";
import { diagnoseBottlenecks } from "@/lib/bottleneck/diagnosis";
import { handleError, ok, parseWriteJson } from "@/lib/api/responses";
import { resolveUserContext } from "@/lib/api/context";
import { getRepository } from "@/lib/repositories/hermes-repository";
import type { MetaInsight } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const context = await resolveUserContext(request);
    const repository = getRepository();
    const insight = (await parseWriteJson(request)) as MetaInsight;
    const diagnosis = diagnoseBottlenecks(insight);
    const jobId = randomUUID();
    await repository.saveBottleneckAnalysisJob(request, {
      id: jobId,
      tenantId: context.tenantId,
      createdBy: context.userId,
      status: "succeeded",
      dataSufficiency: diagnosis.dataSufficiency,
      resultJson: diagnosis
    });
    await repository.saveBottleneckStageScores(
      request,
      diagnosis.stages.map((stage) => ({
        id: randomUUID(),
        tenantId: context.tenantId,
        createdBy: context.userId,
        bottleneckJobId: jobId,
        stage: stage.stage,
        scoreValue: stage.score,
        confidence: stage.confidence,
        evidenceJson: stage.evidence,
        recommendation: stage.recommendation
      }))
    );
    await repository.saveBottleneckHypotheses(
      request,
      diagnosis.hypotheses.map((hypothesis) => ({
        id: randomUUID(),
        tenantId: context.tenantId,
        createdBy: context.userId,
        bottleneckJobId: jobId,
        hypothesis: hypothesis.hypothesis,
        confidence: hypothesis.confidence,
        evidenceJson: hypothesis.evidence
      }))
    );
    const job = {
      id: jobId,
      tenantId: context.tenantId,
      createdBy: context.userId,
      type: "bottleneck_diagnosis",
      status: "succeeded",
      result: diagnosis
    };
    await repository.saveJob(request, job);
    await repository.saveAuditLog(request, {
      tenantId: context.tenantId,
      userId: context.userId,
      action: "bottleneck_analysis_created",
      objectType: "bottleneck_analysis_job",
      objectId: jobId,
      afterJson: {
        job,
        dataSufficiency: diagnosis.dataSufficiency,
        stageCount: diagnosis.stages.length,
        hypothesisCount: diagnosis.hypotheses.length
      },
      result: "created"
    });
    return ok(job, 201);
  } catch (error) {
    return handleError(error);
  }
}
