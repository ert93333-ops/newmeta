import { NextResponse } from "next/server";
import { buildOpsHealth } from "@/lib/ops/health";

export async function GET() {
  const health = buildOpsHealth(process.env);
  return NextResponse.json(health, { status: health.status === "ready" ? 200 : 503 });
}
