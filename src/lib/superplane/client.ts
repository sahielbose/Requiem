import { randomUUID } from "node:crypto";
import type { ExecutionRecord, MigrationResult } from "../types";

// SuperPlane integration. We don't have the real API surface until on-site,
// so these are clean stubs that let the full pipeline run end-to-end today.
//
// When mentors hand us endpoints + auth: replace the stub bodies below with
// real fetch() calls and remove the early-return blocks. Everything calling
// this module is async + tolerant of a single round-trip, so the swap is local.

export interface PushWorkflowResult {
  workflowId: string;
  canvasUrl: string;
}

export async function pushWorkflow(
  migration: MigrationResult
): Promise<PushWorkflowResult> {
  const apiKey = process.env.SUPERPLANE_API_KEY;

  if (!apiKey) {
    const workflowId = `wf_${migration.scriptId}_${randomUUID().slice(0, 8)}`;
    return {
      workflowId,
      canvasUrl: `https://app.superplane.dev/local/${workflowId}`,
    };
  }

  // TODO(superplane): real client. Expect mentors to provide:
  //   POST https://api.superplane.dev/v1/workflows
  //   Authorization: Bearer ${apiKey}
  //   body: { steps: migration.steps, summary: migration.summary, source_script_id }
  //   response: { workflow_id, canvas_url }
  //
  // const res = await fetch("https://api.superplane.dev/v1/workflows", {
  //   method: "POST",
  //   headers: {
  //     "Content-Type": "application/json",
  //     Authorization: `Bearer ${apiKey}`,
  //   },
  //   body: JSON.stringify({
  //     summary: migration.summary,
  //     source_script_id: migration.scriptId,
  //     steps: migration.steps,
  //   }),
  // });
  // const data = await res.json();
  // return { workflowId: data.workflow_id, canvasUrl: data.canvas_url };

  // Fallback so callers can never be left without a value during the swap window.
  const workflowId = `wf_${migration.scriptId}_${randomUUID().slice(0, 8)}`;
  return {
    workflowId,
    canvasUrl: `https://app.superplane.dev/pending/${workflowId}`,
  };
}

export async function getExecutionHistory(
  workflowId: string
): Promise<ExecutionRecord | null> {
  const apiKey = process.env.SUPERPLANE_API_KEY;

  if (!apiKey) {
    const id = `exec_${workflowId}_${randomUUID().slice(0, 6)}`;
    return {
      id,
      workflowId,
      startedAt: new Date().toISOString(),
      source: "local_log",
      stepResults: [
        { step: "Snapshot current state", status: "success", durationMs: 820 },
        { step: "Pull latest source", status: "success", durationMs: 1240 },
        {
          step: "Install / build artifacts",
          status: "success",
          durationMs: 18400,
        },
        { step: "Approval gate", status: "success", durationMs: 4200 },
        {
          step: "Restart application processes",
          status: "success",
          durationMs: 2900,
        },
        { step: "Probe health endpoint", status: "success", durationMs: 1100 },
        { step: "Notify operators", status: "success", durationMs: 240 },
      ],
    };
  }

  // TODO(superplane): real fetch
  //   GET https://api.superplane.dev/v1/workflows/${workflowId}/executions/latest
  //   Authorization: Bearer ${apiKey}
  //   response: { id, started_at, step_results: [{ step, status, duration_ms }] }
  //
  // const res = await fetch(...);
  // if (!res.ok) return null;
  // const data = await res.json();
  // return {
  //   id: data.id,
  //   workflowId,
  //   startedAt: data.started_at,
  //   source: "superplane",
  //   stepResults: data.step_results.map((r: { step: string; status: ExecutionStepResult["status"]; duration_ms: number }) => ({
  //     step: r.step, status: r.status, durationMs: r.duration_ms,
  //   })),
  // };

  return null;
}
