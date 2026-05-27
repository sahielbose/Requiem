import { ChatAnthropic } from "@langchain/anthropic";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import type {
  BashScript,
  MigrationResult,
  WorkflowStep,
} from "../lib/types";
import { appendAudit } from "../lib/db/queries";

const CLAUDE_MODEL = "claude-sonnet-4-5";
const CLAUDE_TIMEOUT_MS = 25_000;

const PROMPT = PromptTemplate.fromTemplate(`You are the Migration Agent for Requiem. Your job: read a raw bash script and reason about its INTENT (what it is *trying* to do), not its syntax. Output a structured workflow spec.

You will output ONLY a single JSON object. No prose, no markdown fences, no commentary. The JSON must match this exact shape:

{{
  "summary": "<one sentence describing the script's purpose>",
  "steps": [
    {{
      "order": <1-based integer>,
      "type": "command" | "deploy" | "db_migration" | "health_check" | "notification" | "approval_gate" | "backup",
      "description": "<short human description of what this step does>",
      "original": "<the original bash line(s) this step corresponds to>"
    }},
    ...
  ]
}}

Rules:
- Group related lines (e.g. a heredoc, a multi-line curl) into one step.
- Pick the BEST type for each step:
  - "deploy" for build/deploy/restart/release operations
  - "db_migration" for psql, mysql, ALTER, DROP, CREATE TABLE
  - "health_check" for curl /health, wait-for, probe loops
  - "notification" for slack, pagerduty, email, webhook calls
  - "backup" for pg_dump, tar of state, snapshot operations
  - "approval_gate" ONLY if the script explicitly has one (you do not invent gates here — danger-audit adds those)
  - "command" otherwise
- Ignore comments and 'set -e' / shebang lines.
- Preserve the original bash text verbatim in "original" (multi-line OK).

Script filename: {filename}
Path: {path}

Script contents:
\`\`\`bash
{content}
\`\`\`

Return ONLY the JSON object.`);

interface ClaudeOutput {
  summary: string;
  steps: WorkflowStep[];
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`migration-agent: claude timeout after ${ms}ms`)),
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
  // strip ```json ... ``` fences if Claude wraps despite instructions
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1].trim() : trimmed;

  // find the outermost {...} in case there's leading/trailing text
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("migration-agent: no JSON object in claude output");
  }
  return JSON.parse(body.slice(start, end + 1));
}

function validateClaudeOutput(obj: unknown): ClaudeOutput {
  if (typeof obj !== "object" || obj === null) {
    throw new Error("migration-agent: claude output is not an object");
  }
  const o = obj as { summary?: unknown; steps?: unknown };
  if (typeof o.summary !== "string") {
    throw new Error("migration-agent: missing summary");
  }
  if (!Array.isArray(o.steps)) {
    throw new Error("migration-agent: steps is not an array");
  }
  const validTypes = new Set<WorkflowStep["type"]>([
    "command",
    "deploy",
    "db_migration",
    "health_check",
    "notification",
    "approval_gate",
    "backup",
  ]);
  const steps: WorkflowStep[] = o.steps.map((s, i) => {
    const step = s as Partial<WorkflowStep>;
    if (
      typeof step.order !== "number" ||
      typeof step.description !== "string" ||
      typeof step.original !== "string" ||
      !step.type ||
      !validTypes.has(step.type)
    ) {
      throw new Error(`migration-agent: invalid step at index ${i}`);
    }
    return {
      order: step.order,
      type: step.type,
      description: step.description,
      original: step.original,
    };
  });
  return { summary: o.summary, steps };
}

async function runWithClaude(script: BashScript): Promise<ClaudeOutput> {
  const model = new ChatAnthropic({
    model: CLAUDE_MODEL,
    temperature: 0,
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const chain = PROMPT.pipe(model).pipe(new StringOutputParser());

  const raw = await withTimeout(
    chain.invoke({
      filename: script.filename,
      path: script.path,
      content: script.content,
    }),
    CLAUDE_TIMEOUT_MS
  );

  return validateClaudeOutput(extractJson(raw));
}

// ---------- deterministic fallback ----------

interface RuleMatch {
  type: WorkflowStep["type"];
  describe: (line: string) => string;
}

const RULES: Array<{ test: RegExp; match: RuleMatch }> = [
  {
    test: /\b(git\s+pull|git\s+clone|git\s+fetch)\b/i,
    match: { type: "deploy", describe: () => "Pull latest source" },
  },
  {
    test: /\b(npm|yarn|pnpm)\s+(run\s+)?(build|install)\b/i,
    match: { type: "deploy", describe: () => "Install / build artifacts" },
  },
  {
    test: /\b(pm2|systemctl|docker|kubectl)\s+(restart|rollout|deploy|reload|apply)\b/i,
    match: {
      type: "deploy",
      describe: (l) => `Restart / deploy: ${l.trim()}`,
    },
  },
  {
    test: /\b(pg_dump|mysqldump)\b/i,
    match: { type: "backup", describe: () => "Database snapshot / dump" },
  },
  {
    test: /\b(psql|mysql|mongo)\b/i,
    match: {
      type: "db_migration",
      describe: (l) => `Database op: ${l.trim().slice(0, 80)}`,
    },
  },
  {
    test: /\b(ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+TABLE|TRUNCATE)\b/i,
    match: {
      type: "db_migration",
      describe: (l) => `Schema change: ${l.trim()}`,
    },
  },
  {
    test: /\bcurl\b.*\/(health|ready|status)\b/i,
    match: { type: "health_check", describe: () => "Probe health endpoint" },
  },
  {
    test: /(slack|pagerduty|webhook|sendgrid|notify|pageroncall|mailgun)/i,
    match: {
      type: "notification",
      describe: (l) => `Notify: ${l.trim().slice(0, 80)}`,
    },
  },
  {
    test: /\b(tar\s+-c|aws\s+s3\s+cp|snapshot|backup)\b/i,
    match: { type: "backup", describe: (l) => `Backup: ${l.trim()}` },
  },
];

function classifyLine(line: string): RuleMatch | null {
  for (const r of RULES) {
    if (r.test.test(line)) return r.match;
  }
  return null;
}

function fallbackMigrate(script: BashScript): ClaudeOutput {
  const rawLines = script.content.split(/\r?\n/);
  const steps: WorkflowStep[] = [];
  let order = 1;

  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (/^set\s+-/.test(line)) continue;
    if (line === "fi" || line === "done" || line === "then") continue;

    const rule = classifyLine(line);
    const type = rule?.type ?? "command";
    const description = rule
      ? rule.describe(line)
      : `Shell command: ${line.slice(0, 80)}`;

    steps.push({ order: order++, type, description, original: raw });
  }

  if (steps.length === 0) {
    steps.push({
      order: 1,
      type: "command",
      description: "Empty or unparseable script",
      original: script.content,
    });
  }

  return {
    summary: `Fallback parse of ${script.filename} (${steps.length} step${steps.length === 1 ? "" : "s"}).`,
    steps,
  };
}

// ---------- public entry point ----------

export async function runMigrationAgent(
  script: BashScript
): Promise<MigrationResult> {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  let source: "claude" | "fallback" = "fallback";
  let output: ClaudeOutput;

  if (hasKey) {
    try {
      console.log(
        `[migration-agent] calling Claude (${CLAUDE_MODEL}) for ${script.filename}`
      );
      output = await runWithClaude(script);
      source = "claude";
    } catch (err) {
      console.warn(
        `[migration-agent] Claude failed for ${script.filename}, using fallback:`,
        err instanceof Error ? err.message : err
      );
      output = fallbackMigrate(script);
    }
  } else {
    console.log(
      `[migration-agent] ANTHROPIC_API_KEY missing — fallback parse for ${script.filename}`
    );
    output = fallbackMigrate(script);
  }

  const result: MigrationResult = {
    scriptId: script.id,
    steps: output.steps,
    summary: output.summary,
    status: "migrated",
  };

  // Best-effort audit log — never fail the pipeline if the DB is unavailable.
  try {
    await appendAudit({
      timestamp: new Date().toISOString(),
      actor: "migration-agent",
      action: "migrate_script",
      detail: `parsed ${script.filename} into ${result.steps.length} steps via ${source}`,
    });
  } catch (err) {
    console.warn(
      "[migration-agent] audit log write failed (continuing):",
      err instanceof Error ? err.message : err
    );
  }

  return result;
}
