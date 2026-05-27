import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  appendAudit,
  insertExecution,
  updateIncidentStatus,
} from "@/lib/db/queries";
import { getExecutionHistory } from "@/lib/superplane/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { id?: string; approver?: string };
  try {
    body = (await req.json()) as { id?: string; approver?: string };
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body" },
      { status: 400 }
    );
  }

  const id = body.id?.trim();
  const approver = body.approver?.trim();
  if (!id || !approver) {
    return NextResponse.json(
      { error: "id and approver are required" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  let approvedIncident;
  try {
    approvedIncident = await updateIncidentStatus(id, "approved", approver, now);
  } catch (err) {
    console.error(
      "[api/incidents/approve] update failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 }
    );
  }

  if (!approvedIncident) {
    return NextResponse.json({ error: "incident not found" }, { status: 404 });
  }

  // Simulate the run via the SuperPlane stub.
  const stub = await getExecutionHistory(approvedIncident.workflowId);
  let executionRecord = null;
  if (stub) {
    executionRecord = {
      ...stub,
      id: `exec_${randomUUID().slice(0, 8)}`,
      workflowId: approvedIncident.workflowId,
      startedAt: new Date().toISOString(),
    };
    try {
      await insertExecution(executionRecord);
    } catch (err) {
      console.warn(
        "[api/incidents/approve] insertExecution failed (continuing):",
        err instanceof Error ? err.message : err
      );
    }
  }

  // Mark the incident complete now that the simulated run has finished.
  let finalIncident = approvedIncident;
  try {
    const completed = await updateIncidentStatus(id, "complete");
    if (completed) finalIncident = completed;
  } catch (err) {
    console.warn(
      "[api/incidents/approve] mark complete failed (continuing):",
      err instanceof Error ? err.message : err
    );
  }

  try {
    await appendAudit({
      timestamp: new Date().toISOString(),
      actor: approver,
      action: "approve_incident",
      detail: `incident ${id} approved and ${executionRecord ? "executed" : "queued without execution record"}`,
    });
  } catch {
    // tolerate audit log unavailable
  }

  return NextResponse.json({
    incident: finalIncident,
    execution: executionRecord,
  });
}
