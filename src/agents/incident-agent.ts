import { ChatAnthropic } from "@langchain/anthropic";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { randomUUID } from "node:crypto";
import type { BashScript, DangerFlag, Incident, MigrationResult } from "../lib/types";
import { appendAudit, insertIncident } from "../lib/db/queries";

const CLAUDE_MODEL = "claude-sonnet-4-5";
const CLAUDE_TIMEOUT_MS = 25_000;

const PROMPT = PromptTemplate.fromTemplate(`You are the Incident Agent for Requiem — the on-call AI that turns dangerous production script patterns into actionable incident diagnoses.

You receive: an alert about a bash script with danger flags, and the safe migrated workflow Requiem already generated to replace it. Your job: write a clear incident diagnosis and a concrete proposed fix.

Output ONLY a single JSON object. No prose, no markdown fences, no commentary:

{{
  "diagnosis": "<2–4 sentences: what is dangerous, what fails at runtime, what the operator sees vs. what is actually true>",
  "proposedFix": "<concrete steps that reference the migrated workflow's safety steps by step number and description>"
}}

Rules:
- diagnosis: explain the specific failure mode — what command fails, what side effect propagates, what the operator is told vs. reality.
- proposedFix: reference the migrated workflow's approval_gate, health_check, and backup steps by number and description.
- Be technically precise. Operators read this at 2 AM.
- If the migrated workflow already covers the danger, explain which steps to run and why they are safe.
- Never repeat the alert summary verbatim — synthesise and explain.

Script filename: {filename}
Alert source: {alertSource}
Alert summary: {alertSummary}

Danger flags:
{flags}

Migrated workflow (safe version of the script with Requiem safety additions):
{workflow}

Return ONLY the JSON object.`);

interface ClaudeOutput {
  diagnosis: string;
  proposedFix: string;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`incident-agent: claude timeout after ${ms}ms`)),
      ms
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1].trim() : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("incident-agent: no JSON object in claude output");
  }
  return JSON.parse(body.slice(start, end + 1));
}

function validateClaudeOutput(obj: unknown): ClaudeOutput {
  if (typeof obj !== "object" || obj === null) {
    throw new Error("incident-agent: output is not an object");
  }
  const o = obj as { diagnosis?: unknown; proposedFix?: unknown };
  if (typeof o.diagnosis !== "string" || !o.diagnosis.trim()) {
    throw new Error("incident-agent: missing diagnosis");
  }
  if (typeof o.proposedFix !== "string" || !o.proposedFix.trim()) {
    throw new Error("incident-agent: missing proposedFix");
  }
  return { diagnosis: o.diagnosis, proposedFix: o.proposedFix };
}

async function runWithClaude(
  script: BashScript,
  migration: MigrationResult,
  flags: DangerFlag[],
  alertSource: string,
  alertSummary: string
): Promise<ClaudeOutput> {
  const model = new ChatAnthropic({
    model: CLAUDE_MODEL,
    temperature: 0,
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const chain = PROMPT.pipe(model).pipe(new StringOutputParser());

  const flagsText =
    flags.length > 0
      ? flags
          .map(
            (f) =>
              `[${f.severity.toUpperCase()}] ${f.pattern}: ${f.description}\n  Fix hint: ${f.fix}`
          )
          .join("\n")
      : "(none)";

  const workflowText = migration.steps
    .map((s) => `  Step ${s.order} [${s.type}]: ${s.description}`)
    .join("\n");

  const raw = await withTimeout(
    chain.invoke({
      filename: script.filename,
      alertSource,
      alertSummary,
      flags: flagsText,
      workflow: workflowText,
    }),
    CLAUDE_TIMEOUT_MS
  );

  return validateClaudeOutput(extractJson(raw));
}

// ---------- deterministic fallback ----------

function fallbackDiagnose(
  script: BashScript,
  migration: MigrationResult,
  flags: DangerFlag[],
  alertSummary: string
): ClaudeOutput {
  const critical = flags.filter((f) => f.severity === "critical");
  const primary = critical[0] ?? flags[0];

  if (!primary) {
    return {
      diagnosis: `Alert triggered for ${script.filename}: ${alertSummary}. No specific danger flags could be analysed — manual review required.`,
      proposedFix: `Inspect the migrated workflow for ${script.filename} and run it with all safety gates honoured.`,
    };
  }

  const approvalStep = migration.steps.find((s) => s.type === "approval_gate");
  const healthStep = migration.steps.find((s) => s.type === "health_check");
  const backupStep = migration.steps.find((s) => s.type === "backup");

  const safetySteps = [
    backupStep
      ? `Step ${backupStep.order} — ${backupStep.description}`
      : null,
    approvalStep
      ? `Step ${approvalStep.order} — ${approvalStep.description}`
      : null,
    healthStep
      ? `Step ${healthStep.order} — ${healthStep.description}`
      : null,
  ]
    .filter(Boolean)
    .join(", then ");

  const diagnosis =
    `In ${script.filename}: ${primary.description} ` +
    `This is a ${primary.severity} pattern (${primary.pattern}) that can cause silent production failures — ` +
    `operators may receive a misleading status signal while the system is actually degraded.`;

  const proposedFix = safetySteps
    ? `Run the migrated ${script.filename} workflow. Requiem has pre-inserted: ${safetySteps}. ${primary.fix}`
    : `Run the migrated ${script.filename} workflow. ${primary.fix}`;

  return { diagnosis, proposedFix };
}

// ---------- public entry point ----------

export async function runIncidentAgent(
  script: BashScript,
  migration: MigrationResult,
  flags: DangerFlag[],
  alertSource: string,
  alertSummary: string,
  workflowId: string
): Promise<Incident> {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  let source: "claude" | "fallback" = "fallback";
  let output: ClaudeOutput;

  if (hasKey) {
    try {
      console.log(
        `[incident-agent] calling Claude (${CLAUDE_MODEL}) for ${script.filename}`
      );
      output = await runWithClaude(script, migration, flags, alertSource, alertSummary);
      source = "claude";
    } catch (err) {
      console.warn(
        `[incident-agent] Claude failed for ${script.filename}, using fallback:`,
        err instanceof Error ? err.message : err
      );
      output = fallbackDiagnose(script, migration, flags, alertSummary);
    }
  } else {
    console.log(
      `[incident-agent] ANTHROPIC_API_KEY missing — fallback diagnose for ${script.filename}`
    );
    output = fallbackDiagnose(script, migration, flags, alertSummary);
  }

  const incident: Incident = {
    id: `incident_${randomUUID().slice(0, 8)}`,
    alertSource,
    alertSummary,
    workflowId,
    diagnosis: output.diagnosis,
    proposedFix: output.proposedFix,
    status: "awaiting_approval",
    createdAt: new Date().toISOString(),
  };

  try {
    await insertIncident(incident);
  } catch (err) {
    console.warn(
      "[incident-agent] insertIncident failed (continuing):",
      err instanceof Error ? err.message : err
    );
  }

  try {
    await appendAudit({
      timestamp: new Date().toISOString(),
      actor: "incident-agent",
      action: "create_incident",
      detail: `created incident ${incident.id} for ${script.filename} via ${source}`,
    });
  } catch (err) {
    console.warn(
      "[incident-agent] audit log write failed (continuing):",
      err instanceof Error ? err.message : err
    );
  }

  return incident;
}
