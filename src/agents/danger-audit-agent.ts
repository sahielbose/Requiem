import { ChatAnthropic } from "@langchain/anthropic";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import type {
  BashScript,
  DangerFlag,
  DangerSeverity,
  MigrationResult,
  WorkflowStep,
} from "../lib/types";
import { appendAudit } from "../lib/db/queries";

const CLAUDE_MODEL = "claude-sonnet-4-5";
const CLAUDE_TIMEOUT_MS = 25_000;

const PROMPT = PromptTemplate.fromTemplate(`You are the Danger-Audit Agent for Requiem — the safety conscience for migrating legacy bash into safe workflows.

You receive: (1) a raw bash script and (2) the proposed workflow it was migrated into. Identify what could BREAK or LIE in production.

Look for:
- destructive ops without backup: DROP TABLE, TRUNCATE, rm -rf, DELETE FROM with no WHERE, FLUSHDB
- production changes with no approval gate (pm2 restart, kubectl apply, systemctl restart of prod, deploys)
- status messages that lie (Slack/PagerDuty "deploy succeeded" sent unconditionally — fires even if the prior step failed)
- missing error handling (no set -e, no health check after restart, ignored exit codes)
- env-var path expansion in destructive ops (rm -rf $TMP_DIR/*)
- secrets/credentials in plaintext

Output ONLY a single JSON object. No prose, no markdown fences, no commentary:

{{
  "flags": [
    {{
      "pattern": "<short pattern name, e.g. 'destructive op without backup'>",
      "severity": "critical" | "warning" | "info",
      "description": "<what is dangerous and why an operator should care>",
      "fix": "<concrete remediation>"
    }}
  ],
  "addedSteps": [
    {{
      "order": <integer, 1-based, your suggested position in the final workflow>,
      "type": "approval_gate" | "backup" | "health_check",
      "description": "<what this safety step does>",
      "original": "(added by danger-audit)"
    }}
  ]
}}

Rules:
- severity 'critical' for anything that can corrupt prod data, lie to operators, or cause irrecoverable loss.
- severity 'warning' for risky-but-recoverable patterns.
- severity 'info' for hygiene issues.
- Suggest a backup step BEFORE destructive db_migration / backup-worthy commands.
- Suggest an approval_gate step BEFORE production-affecting deploys/restarts.
- Suggest a health_check step AFTER restarts whenever a notification fires afterward (so the notification reports the truth).
- Empty arrays are allowed if the workflow is genuinely clean.

Script filename: {filename}
Path: {path}

Script contents:
\`\`\`bash
{content}
\`\`\`

Proposed workflow (already produced by the migration agent):
{workflow}

Return ONLY the JSON object.`);

interface ClaudeOutput {
  flags: DangerFlag[];
  addedSteps: WorkflowStep[];
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`danger-audit-agent: claude timeout after ${ms}ms`)),
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
    throw new Error("danger-audit-agent: no JSON object in claude output");
  }
  return JSON.parse(body.slice(start, end + 1));
}

const VALID_SEVERITY = new Set<DangerSeverity>(["critical", "warning", "info"]);
const VALID_STEP_TYPES = new Set<WorkflowStep["type"]>([
  "command",
  "deploy",
  "db_migration",
  "health_check",
  "notification",
  "approval_gate",
  "backup",
]);

function validateClaudeOutput(
  obj: unknown,
  scriptId: string
): ClaudeOutput {
  if (typeof obj !== "object" || obj === null) {
    throw new Error("danger-audit-agent: output is not an object");
  }
  const o = obj as { flags?: unknown; addedSteps?: unknown };
  if (!Array.isArray(o.flags)) {
    throw new Error("danger-audit-agent: flags is not an array");
  }
  if (!Array.isArray(o.addedSteps)) {
    throw new Error("danger-audit-agent: addedSteps is not an array");
  }

  const flags: DangerFlag[] = o.flags.map((f, i) => {
    const x = f as Partial<DangerFlag>;
    if (
      typeof x.pattern !== "string" ||
      typeof x.description !== "string" ||
      typeof x.fix !== "string" ||
      !x.severity ||
      !VALID_SEVERITY.has(x.severity)
    ) {
      throw new Error(`danger-audit-agent: invalid flag at index ${i}`);
    }
    return {
      scriptId,
      pattern: x.pattern,
      severity: x.severity,
      description: x.description,
      fix: x.fix,
    };
  });

  const addedSteps: WorkflowStep[] = o.addedSteps.map((s, i) => {
    const x = s as Partial<WorkflowStep>;
    if (
      typeof x.order !== "number" ||
      typeof x.description !== "string" ||
      typeof x.original !== "string" ||
      !x.type ||
      !VALID_STEP_TYPES.has(x.type)
    ) {
      throw new Error(`danger-audit-agent: invalid addedStep at index ${i}`);
    }
    return {
      order: x.order,
      type: x.type,
      description: x.description,
      original: x.original,
    };
  });

  return { flags, addedSteps };
}

async function runWithClaude(
  script: BashScript,
  migration: MigrationResult
): Promise<ClaudeOutput> {
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
      workflow: JSON.stringify(
        { summary: migration.summary, steps: migration.steps },
        null,
        2
      ),
    }),
    CLAUDE_TIMEOUT_MS
  );

  return validateClaudeOutput(extractJson(raw), script.id);
}

// ---------- deterministic fallback ----------

interface InsertSpec {
  type: WorkflowStep["type"];
  description: string;
}

interface RulePattern {
  test: RegExp;
  pattern: string;
  severity: DangerSeverity;
  description: string;
  fix: string;
  inserts?: InsertSpec[];
}

const FALLBACK_RULES: RulePattern[] = [
  {
    test: /\brm\s+-rf\b/i,
    pattern: "rm -rf",
    severity: "critical",
    description:
      "rm -rf wipes filesystem paths irreversibly. Combined with env-var expansion, an empty variable can delete unintended roots.",
    fix: "Replace with an explicit allowlist of paths; add a dry-run flag; verify env vars are set before expansion.",
    inserts: [
      {
        type: "approval_gate",
        description:
          "Pause for human approval before destructive filesystem op",
      },
    ],
  },
  {
    test: /\bDROP\s+(TABLE|DATABASE|SCHEMA|INDEX)\b/i,
    pattern: "destructive DDL (DROP)",
    severity: "critical",
    description:
      "DROP destroys schema and data. A failed migration cannot be rolled back without a prior dump.",
    fix: "Take a pg_dump (or equivalent) before applying. Require human approval.",
    inserts: [
      {
        type: "backup",
        description: "pg_dump current database to artifact store",
      },
      {
        type: "approval_gate",
        description: "Require explicit approval before mutating prod DB",
      },
    ],
  },
  {
    test: /\bTRUNCATE\b/i,
    pattern: "TRUNCATE without backup",
    severity: "critical",
    description:
      "TRUNCATE wipes a table's rows and cannot be rolled back without a prior dump.",
    fix: "Snapshot before TRUNCATE; require approval.",
    inserts: [
      { type: "backup", description: "Snapshot table before TRUNCATE" },
      {
        type: "approval_gate",
        description: "Require approval before TRUNCATE",
      },
    ],
  },
  {
    test: /\bDELETE\s+FROM\b(?![^;]*\bWHERE\b)/i,
    pattern: "DELETE FROM without WHERE",
    severity: "critical",
    description:
      "DELETE FROM with no WHERE clause empties the entire table.",
    fix: "Add a WHERE clause; snapshot first.",
    inserts: [
      { type: "backup", description: "Snapshot table before destructive DELETE" },
    ],
  },
  {
    test: /\bpsql\s+\$?[A-Z_]*DATABASE_URL\b/i,
    pattern: "prod psql with no approval/backup",
    severity: "warning",
    description:
      "Runs SQL against $DATABASE_URL with no gate or backup. Any mutation is irreversible.",
    fix: "Insert backup + approval_gate before psql.",
    inserts: [
      { type: "backup", description: "pg_dump before applying SQL" },
      {
        type: "approval_gate",
        description: "Approval gate before mutating prod DB",
      },
    ],
  },
  {
    test: /\bpm2\s+(restart|reload|stop)\b/i,
    pattern: "prod restart with no approval",
    severity: "warning",
    description:
      "pm2 restart touches production processes with no human checkpoint.",
    fix: "Insert approval_gate before restart; health-check after.",
    inserts: [
      {
        type: "approval_gate",
        description: "Pause for human approval before restarting prod",
      },
      {
        type: "health_check",
        description: "Verify app responds 200 after restart",
      },
    ],
  },
  {
    test: /\b(kubectl\s+(apply|delete|rollout|replace)|systemctl\s+(restart|stop))\b/i,
    pattern: "prod infra mutation without approval",
    severity: "warning",
    description:
      "Infrastructure command touches prod with no human gate.",
    fix: "Insert approval_gate before; health_check after.",
    inserts: [
      {
        type: "approval_gate",
        description: "Approval gate before infra mutation",
      },
      {
        type: "health_check",
        description: "Health check after infra mutation",
      },
    ],
  },
  {
    test: /(curl[^\n]*slack|slack[^\n]*webhook|pagerduty|sendgrid|mailgun)/i,
    pattern: "unconditional notification",
    severity: "critical",
    description:
      "Notification fires regardless of upstream success. Operators see a lie when the prior step fails.",
    fix: "Add a health_check before the notification and report actual status.",
    inserts: [
      {
        type: "health_check",
        description: "Verify upstream succeeded before notifying",
      },
    ],
  },
  {
    test: /--force\b/,
    pattern: "--force flag",
    severity: "warning",
    description:
      "--force suppresses safety prompts and can mask broken state.",
    fix: "Remove --force; handle the underlying conflict explicitly.",
  },
  {
    test: />\s*\/etc\//,
    pattern: "writing to /etc",
    severity: "warning",
    description:
      "Writing to /etc changes system config and typically requires a restart to take effect.",
    fix: "Use a config management tool; require approval.",
  },
  {
    test: /redis-cli\s+FLUSHDB|redis-cli\s+FLUSHALL/i,
    pattern: "Redis FLUSHDB / FLUSHALL",
    severity: "critical",
    description: "FLUSHDB / FLUSHALL wipes the Redis database. No recovery.",
    fix: "Snapshot Redis before; require approval.",
    inserts: [
      { type: "backup", description: "Snapshot Redis before FLUSH" },
      { type: "approval_gate", description: "Approval gate before FLUSH" },
    ],
  },
  {
    test: /^(?!.*\bset\s+-e\b)[\s\S]*$/,
    pattern: "missing set -e",
    severity: "info",
    description:
      "Script does not use `set -e`. A failing command will not halt the script, letting subsequent steps run on corrupted state.",
    fix: "Add `set -e` at the top of the script.",
  },
];

function fallbackAudit(
  script: BashScript,
  migration: MigrationResult
): ClaudeOutput {
  const flags: DangerFlag[] = [];
  const insertsByKey = new Map<string, WorkflowStep>();

  for (const rule of FALLBACK_RULES) {
    if (rule.test.test(script.content)) {
      flags.push({
        scriptId: script.id,
        pattern: rule.pattern,
        severity: rule.severity,
        description: rule.description,
        fix: rule.fix,
      });
      if (rule.inserts) {
        for (const ins of rule.inserts) {
          const key = `${ins.type}|${ins.description}`;
          if (!insertsByKey.has(key)) {
            insertsByKey.set(key, {
              order: 0,
              type: ins.type,
              description: ins.description,
              original: "(added by danger-audit)",
            });
          }
        }
      }
    }
  }

  const baseOrder = (migration.steps.length || 0) + 1;
  const addedSteps: WorkflowStep[] = [];
  let i = 0;
  for (const step of insertsByKey.values()) {
    addedSteps.push({ ...step, order: baseOrder + i });
    i++;
  }

  return { flags, addedSteps };
}

// ---------- public entry point ----------

export async function runDangerAudit(
  script: BashScript,
  migration: MigrationResult
): Promise<{ flags: DangerFlag[]; addedSteps: WorkflowStep[] }> {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  let source: "claude" | "fallback" = "fallback";
  let output: ClaudeOutput;

  if (hasKey) {
    try {
      console.log(
        `[danger-audit-agent] calling Claude (${CLAUDE_MODEL}) for ${script.filename}`
      );
      output = await runWithClaude(script, migration);
      source = "claude";
    } catch (err) {
      console.warn(
        `[danger-audit-agent] Claude failed for ${script.filename}, using fallback:`,
        err instanceof Error ? err.message : err
      );
      output = fallbackAudit(script, migration);
    }
  } else {
    console.log(
      `[danger-audit-agent] ANTHROPIC_API_KEY missing — fallback audit for ${script.filename}`
    );
    output = fallbackAudit(script, migration);
  }

  try {
    await appendAudit({
      timestamp: new Date().toISOString(),
      actor: "danger-audit-agent",
      action: "audit_script",
      detail: `danger audit: ${output.flags.length} flag(s) on ${script.filename} via ${source}`,
    });
  } catch (err) {
    console.warn(
      "[danger-audit-agent] audit log write failed (continuing):",
      err instanceof Error ? err.message : err
    );
  }

  return output;
}
