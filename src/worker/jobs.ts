import { randomUUID } from "node:crypto";
import type { BashScript, MigrationResult, WorkflowStep } from "../lib/types";
import { runMigrationAgent } from "../agents/migration-agent";
import { runDangerAudit } from "../agents/danger-audit-agent";
import { runIncidentAgent } from "../agents/incident-agent";
import { runReviewerAgent } from "../agents/reviewer-agent";
import {
  appendAudit,
  insertDangers,
  insertMigration,
  insertScript,
} from "../lib/db/queries";
import { query } from "../lib/db/client";
import { pushWorkflow } from "../lib/superplane/client";

// Re-scanning a script must be idempotent: a fresh agent pass produces a
// fresh migration + danger set. Without this clear step the ledger query
// (which aggregates ALL dangers for a script_id but only the latest
// migration) ends up with stale flags multiplied across runs.
async function clearPriorAgentOutput(scriptId: string): Promise<void> {
  try {
    await query(`DELETE FROM dangers WHERE script_id = $1`, [scriptId]);
    await query(`DELETE FROM migrations WHERE script_id = $1`, [scriptId]);
  } catch (err) {
    console.warn(
      `[worker] clearPriorAgentOutput failed for ${scriptId} (continuing):`,
      err instanceof Error ? err.message : err
    );
  }
}

export type JobStatus = "queued" | "running" | "complete" | "failed";

export interface JobProgress {
  total: number;
  processed: number;
  currentScript: string | null;
  currentStep: string | null;
}

export interface JobWorkflowEntry {
  scriptId: string;
  filename: string;
  workflowId: string;
  canvasUrl: string;
}

export interface JobRecord {
  id: string;
  type: "scan";
  repoUrl: string;
  status: JobStatus;
  progress: JobProgress;
  errors: string[];
  workflows: JobWorkflowEntry[];
  createdAt: string;
  finishedAt: string | null;
}

// In Next.js dev mode each route handler bundles independently, so a plain
// module-level Map ends up duplicated across routes (POST /api/scan would
// write to one copy, GET /api/scan/status would read from another). Attaching
// the singleton state to globalThis keeps every route pointing at the same
// queue regardless of how Next compiles the bundles.
interface WorkerSingleton {
  jobs: Map<string, JobRecord>;
  jobInputs: Map<string, BashScript[]>;
  queue: string[];
  processing: boolean;
}

const globalForWorker = globalThis as unknown as {
  __requiemWorker?: WorkerSingleton;
};

const singleton: WorkerSingleton =
  globalForWorker.__requiemWorker ??
  (globalForWorker.__requiemWorker = {
    jobs: new Map<string, JobRecord>(),
    jobInputs: new Map<string, BashScript[]>(),
    queue: [],
    processing: false,
  });

const { jobs, jobInputs, queue } = singleton;

export function enqueueScanJob(
  repoUrl: string,
  scripts: BashScript[]
): JobRecord {
  const id = `job_${randomUUID()}`;
  const job: JobRecord = {
    id,
    type: "scan",
    repoUrl,
    status: "queued",
    progress: {
      total: scripts.length,
      processed: 0,
      currentScript: null,
      currentStep: null,
    },
    errors: [],
    workflows: [],
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(id, job);
  jobInputs.set(id, scripts);
  queue.push(id);
  void runQueue();
  return job;
}

export function getJob(id: string): JobRecord | null {
  return jobs.get(id) ?? null;
}

export function listJobs(): JobRecord[] {
  return Array.from(jobs.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}

async function runQueue(): Promise<void> {
  if (singleton.processing) return;
  singleton.processing = true;
  try {
    while (queue.length > 0) {
      const id = queue.shift()!;
      const job = jobs.get(id);
      const scripts = jobInputs.get(id);
      if (!job || !scripts) continue;
      jobInputs.delete(id);
      try {
        await processScanJob(job, scripts);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        job.errors.push(`fatal: ${msg}`);
        job.status = "failed";
        job.finishedAt = new Date().toISOString();
        console.error("[worker] job failed:", msg);
      }
    }
  } finally {
    singleton.processing = false;
  }
}

function mergeWorkflow(
  base: WorkflowStep[],
  added: WorkflowStep[]
): WorkflowStep[] {
  const backups = added.filter((s) => s.type === "backup");
  const gates = added.filter((s) => s.type === "approval_gate");
  const healths = added.filter((s) => s.type === "health_check");

  const result: WorkflowStep[] = [];

  let pendingBackups = [...backups];
  let pendingGates = [...gates];
  let pendingHealths = [...healths];

  for (const step of base) {
    const isRisky =
      step.type === "deploy" ||
      step.type === "db_migration" ||
      /restart|reload|apply/i.test(step.original);

    if (isRisky) {
      result.push(...pendingBackups);
      pendingBackups = [];
      result.push(...pendingGates);
      pendingGates = [];
    }

    result.push(step);

    if (isRisky && pendingHealths.length > 0) {
      result.push(...pendingHealths);
      pendingHealths = [];
    }
  }

  // append leftovers defensively
  result.push(...pendingBackups, ...pendingGates, ...pendingHealths);

  return result.map((s, i) => ({ ...s, order: i + 1 }));
}

async function processScanJob(
  job: JobRecord,
  scripts: BashScript[]
): Promise<void> {
  job.status = "running";

  try {
    await appendAudit({
      timestamp: new Date().toISOString(),
      actor: "worker",
      action: "scan_start",
      detail: `job ${job.id}: ${scripts.length} script(s) from ${job.repoUrl}`,
    });
  } catch {
    // tolerate audit log being unavailable
  }

  for (const script of scripts) {
    job.progress.currentScript = script.filename;
    try {
      job.progress.currentStep = "insert_script";
      try {
        await insertScript(script);
      } catch (err) {
        console.warn(
          `[worker] insertScript failed for ${script.filename} (continuing):`,
          err instanceof Error ? err.message : err
        );
      }

      job.progress.currentStep = "migration_agent";
      const migration = await runMigrationAgent(script);

      job.progress.currentStep = "danger_audit_agent";
      const audit = await runDangerAudit(script, migration);

      const mergedSteps = mergeWorkflow(migration.steps, audit.addedSteps);
      let finalMigration: MigrationResult = {
        ...migration,
        steps: mergedSteps,
      };

      // Reviewer agent: self-critique pass on the merged workflow.
      job.progress.currentStep = "reviewer_agent";
      try {
        const review = await runReviewerAgent(script, finalMigration.steps);
        if (!review.passed && review.addedSteps.length > 0) {
          const patched = mergeWorkflow(finalMigration.steps, review.addedSteps);
          finalMigration = { ...finalMigration, steps: patched };
        }
      } catch (err) {
        console.warn(
          `[worker] reviewer agent failed for ${script.filename} (continuing):`,
          err instanceof Error ? err.message : err
        );
      }

      job.progress.currentStep = "persist_migration";
      try {
        await clearPriorAgentOutput(script.id);
        await insertMigration(finalMigration);
        await insertDangers(audit.flags);
      } catch (err) {
        console.warn(
          `[worker] persist failed for ${script.filename} (continuing):`,
          err instanceof Error ? err.message : err
        );
      }

      job.progress.currentStep = "push_workflow";
      const wf = await pushWorkflow(finalMigration);
      job.workflows.push({
        scriptId: script.id,
        filename: script.filename,
        workflowId: wf.workflowId,
        canvasUrl: wf.canvasUrl,
      });

      const criticalFlags = audit.flags.filter((f) => f.severity === "critical");
      if (criticalFlags.length > 0) {
        job.progress.currentStep = "incident_agent";
        try {
          const alertSummary =
            `${criticalFlags.length} critical danger${criticalFlags.length === 1 ? "" : "s"} in ${script.filename}: ` +
            criticalFlags[0].pattern;
          await runIncidentAgent(
            script,
            finalMigration,
            audit.flags,
            "Requiem Danger Audit",
            alertSummary,
            wf.workflowId
          );
        } catch (err) {
          console.warn(
            `[worker] incident agent failed for ${script.filename} (continuing):`,
            err instanceof Error ? err.message : err
          );
        }
      }

      job.progress.processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      job.errors.push(`${script.filename}: ${msg}`);
      console.error(`[worker] script ${script.filename} failed:`, msg);
    }
  }

  job.progress.currentScript = null;
  job.progress.currentStep = null;
  job.status =
    job.progress.processed === 0 && job.errors.length > 0
      ? "failed"
      : "complete";
  job.finishedAt = new Date().toISOString();

  try {
    await appendAudit({
      timestamp: new Date().toISOString(),
      actor: "worker",
      action: "scan_complete",
      detail: `job ${job.id}: processed ${job.progress.processed}/${job.progress.total}, ${job.errors.length} error(s)`,
    });
  } catch {
    // tolerate audit log being unavailable
  }
}
