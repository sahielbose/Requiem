import { ChatAnthropic } from "@langchain/anthropic";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import type { BashScript, WorkflowStep } from "../lib/types";
import { appendAudit } from "../lib/db/queries";

const CLAUDE_MODEL = "claude-sonnet-4-5";
const CLAUDE_TIMEOUT_MS = 20_000;

const PROMPT = PromptTemplate.fromTemplate(`You are the Reviewer Agent for Requiem — the self-critique pass that checks the other agents' work.

The Migration Agent parsed a bash script into workflow steps. The Danger-Audit Agent added safety steps (approval_gate, backup, health_check). You receive the FINAL merged workflow.

Your job: verify no safety gaps remain. Check these invariants:
1. Every 'deploy' or 'db_migration' step MUST have an 'approval_gate' within the 2 steps immediately before it.
2. Every 'notification' step MUST have a 'health_check' within the 2 steps immediately before it.
3. Every 'db_migration' step MUST have a 'backup' within the 2 steps before it.
4. Any 'command' step whose original contains "rm -rf", "DROP", or "TRUNCATE" must have 'approval_gate' or 'backup' before it.

Output ONLY a single JSON object — no prose, no fences:

{{
  "passed": true,
  "gaps": [],
  "addedSteps": []
}}

or if gaps found:

{{
  "passed": false,
  "gaps": ["<one sentence per gap>"],
  "addedSteps": [
    {{
      "order": <suggested position>,
      "type": "approval_gate" | "backup" | "health_check",
      "description": "<what this step does>",
      "original": "(added by reviewer)"
    }}
  ]
}}

Script filename: {filename}
Final workflow:
{workflow}

Return ONLY the JSON object.`);

export interface ReviewResult {
  passed: boolean;
  gaps: string[];
  addedSteps: WorkflowStep[];
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`reviewer-agent: timeout after ${ms}ms`)),
      ms
    );
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1].trim() : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("reviewer-agent: no JSON in output");
  return JSON.parse(body.slice(start, end + 1));
}

function validateOutput(obj: unknown): ReviewResult {
  if (typeof obj !== "object" || obj === null) throw new Error("not an object");
  const o = obj as { passed?: unknown; gaps?: unknown; addedSteps?: unknown };
  if (typeof o.passed !== "boolean") throw new Error("missing passed");
  if (!Array.isArray(o.gaps)) throw new Error("gaps not array");
  if (!Array.isArray(o.addedSteps)) throw new Error("addedSteps not array");
  const addedSteps: WorkflowStep[] = o.addedSteps.map((s, i) => {
    const x = s as Partial<WorkflowStep>;
    if (typeof x.order !== "number" || typeof x.description !== "string") {
      throw new Error(`invalid addedStep at ${i}`);
    }
    return {
      order: x.order,
      type: x.type ?? "approval_gate",
      description: x.description,
      original: "(added by reviewer)",
    };
  });
  return {
    passed: o.passed,
    gaps: (o.gaps as unknown[]).filter((g): g is string => typeof g === "string"),
    addedSteps,
  };
}

async function runWithClaude(
  script: BashScript,
  steps: WorkflowStep[]
): Promise<ReviewResult> {
  const model = new ChatAnthropic({
    model: CLAUDE_MODEL,
    temperature: 0,
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  const chain = PROMPT.pipe(model).pipe(new StringOutputParser());
  const workflowText = steps
    .map((s) => `  Step ${s.order} [${s.type}]: ${s.description}`)
    .join("\n");
  const raw = await withTimeout(
    chain.invoke({ filename: script.filename, workflow: workflowText }),
    CLAUDE_TIMEOUT_MS
  );
  return validateOutput(extractJson(raw));
}

// ---------- deterministic fallback ----------

function stepsAround(steps: WorkflowStep[], idx: number, window: number): WorkflowStep[] {
  return steps.slice(Math.max(0, idx - window), idx);
}

function fallbackReview(steps: WorkflowStep[]): ReviewResult {
  const gaps: string[] = [];
  const addedSteps: WorkflowStep[] = [];

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const before = stepsAround(steps, i, 2).map((x) => x.type);

    if (s.type === "deploy" || s.type === "db_migration") {
      if (!before.includes("approval_gate")) {
        gaps.push(
          `Step ${s.order} [${s.type}] "${s.description}" has no approval_gate before it.`
        );
        addedSteps.push({
          order: s.order,
          type: "approval_gate",
          description: `Approval gate before ${s.description}`,
          original: "(added by reviewer)",
        });
      }
    }

    if (s.type === "db_migration") {
      if (!before.includes("backup")) {
        gaps.push(
          `Step ${s.order} [db_migration] "${s.description}" has no backup before it.`
        );
        addedSteps.push({
          order: s.order,
          type: "backup",
          description: `Snapshot before ${s.description}`,
          original: "(added by reviewer)",
        });
      }
    }

    if (s.type === "notification") {
      if (!before.includes("health_check")) {
        gaps.push(
          `Step ${s.order} [notification] "${s.description}" has no health_check before it — it may report a lie.`
        );
        addedSteps.push({
          order: s.order,
          type: "health_check",
          description: "Verify system health before notifying",
          original: "(added by reviewer)",
        });
      }
    }
  }

  return { passed: gaps.length === 0, gaps, addedSteps };
}

// ---------- public entry point ----------

export async function runReviewerAgent(
  script: BashScript,
  steps: WorkflowStep[]
): Promise<ReviewResult> {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  let source: "claude" | "fallback" = "fallback";
  let result: ReviewResult;

  if (hasKey) {
    try {
      console.log(`[reviewer-agent] calling Claude for ${script.filename}`);
      result = await runWithClaude(script, steps);
      source = "claude";
    } catch (err) {
      console.warn(
        `[reviewer-agent] Claude failed for ${script.filename}, using fallback:`,
        err instanceof Error ? err.message : err
      );
      result = fallbackReview(steps);
    }
  } else {
    result = fallbackReview(steps);
  }

  const status = result.passed
    ? `passed (${steps.length} steps reviewed)`
    : `${result.gaps.length} gap(s) found: ${result.gaps.slice(0, 2).join("; ")}`;

  try {
    await appendAudit({
      timestamp: new Date().toISOString(),
      actor: "reviewer-agent",
      action: result.passed ? "review_passed" : "review_issues",
      detail: `${script.filename}: ${status} via ${source}`,
    });
  } catch {
    // tolerate audit log unavailable
  }

  return result;
}
