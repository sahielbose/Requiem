import type {
  BashScript,
  MigrationResult,
  DangerFlag,
  Incident,
  ExecutionRecord,
} from "./types";

const REPO = "https://github.com/example/legacy-ops";

export const mockScripts: BashScript[] = [
  {
    id: "script-1",
    repoUrl: REPO,
    path: "scripts/deploy.sh",
    filename: "deploy.sh",
    content:
      "#!/bin/bash\nset -e\ngit pull origin main\nnpm run build\npm2 restart app\ncurl -X POST $SLACK_WEBHOOK -d '{\"text\":\"Deploy succeeded\"}'\n",
    createdAt: "2026-05-26T14:01:00Z",
  },
  {
    id: "script-2",
    repoUrl: REPO,
    path: "scripts/db_migrate.sh",
    filename: "db_migrate.sh",
    content:
      "#!/bin/bash\npsql $DATABASE_URL -f migrations/001_add_users.sql\necho 'Migration complete'\n",
    createdAt: "2026-05-26T14:01:05Z",
  },
  {
    id: "script-3",
    repoUrl: REPO,
    path: "runbooks/restart_workers.sh",
    filename: "restart_workers.sh",
    content:
      "#!/bin/bash\nsudo systemctl restart workers\nsleep 5\ncurl http://localhost:8080/health\n",
    createdAt: "2026-05-26T14:01:10Z",
  },
  {
    id: "script-4",
    repoUrl: REPO,
    path: "scripts/cleanup.sh",
    filename: "cleanup.sh",
    content: "#!/bin/bash\nrm -rf /tmp/cache/*\nrm -rf logs/*.log\n",
    createdAt: "2026-05-26T14:01:15Z",
  },
];

export const mockMigrations: MigrationResult[] = [
  {
    scriptId: "script-1",
    status: "migrated",
    summary:
      "Production deploy: pulls latest code, builds, restarts process manager, notifies Slack.",
    steps: [
      {
        order: 1,
        type: "backup",
        description: "Snapshot current build before pulling",
        original: "(added by danger-audit)",
      },
      {
        order: 2,
        type: "command",
        description: "Pull latest from main",
        original: "git pull origin main",
      },
      {
        order: 3,
        type: "deploy",
        description: "Build production bundle",
        original: "npm run build",
      },
      {
        order: 4,
        type: "approval_gate",
        description: "Pause for human approval before restarting prod",
        original: "(added by danger-audit)",
      },
      {
        order: 5,
        type: "command",
        description: "Restart application processes",
        original: "pm2 restart app",
      },
      {
        order: 6,
        type: "health_check",
        description: "Verify app responds 200 before notifying",
        original: "(added by danger-audit)",
      },
      {
        order: 7,
        type: "notification",
        description: "Notify Slack with truthful status",
        original:
          "curl -X POST $SLACK_WEBHOOK -d '{\"text\":\"Deploy succeeded\"}'",
      },
    ],
  },
  {
    scriptId: "script-2",
    status: "migrated",
    summary:
      "Database migration: applies user schema change with mandatory backup + rollback path.",
    steps: [
      {
        order: 1,
        type: "backup",
        description: "pg_dump current database to artifact store",
        original: "(added by danger-audit)",
      },
      {
        order: 2,
        type: "approval_gate",
        description: "Require explicit approval before mutating prod DB",
        original: "(added by danger-audit)",
      },
      {
        order: 3,
        type: "db_migration",
        description: "Apply 001_add_users.sql",
        original: "psql $DATABASE_URL -f migrations/001_add_users.sql",
      },
      {
        order: 4,
        type: "health_check",
        description: "Verify table exists and app boots",
        original: "(added by danger-audit)",
      },
      {
        order: 5,
        type: "notification",
        description: "Report actual migration result",
        original: "echo 'Migration complete'",
      },
    ],
  },
  {
    scriptId: "script-3",
    status: "migrated",
    summary:
      "Runbook: restart workers and confirm health endpoint returns 200.",
    steps: [
      {
        order: 1,
        type: "command",
        description: "Restart worker service",
        original: "sudo systemctl restart workers",
      },
      {
        order: 2,
        type: "health_check",
        description: "Probe /health until 200 (with timeout)",
        original: "curl http://localhost:8080/health",
      },
    ],
  },
];

export const mockDangers: DangerFlag[] = [
  {
    scriptId: "script-1",
    pattern: "notification before health check",
    severity: "critical",
    description:
      "Slack message reports success unconditionally, even if pm2 restart fails. Operators will see a lie.",
    fix: "Insert health_check between restart and notification; report actual status.",
  },
  {
    scriptId: "script-1",
    pattern: "no approval gate before prod restart",
    severity: "warning",
    description: "pm2 restart touches production with no human pause.",
    fix: "Inject approval_gate before restart step.",
  },
  {
    scriptId: "script-2",
    pattern: "destructive op without backup",
    severity: "critical",
    description:
      "Schema migration runs against $DATABASE_URL with no pg_dump first. A failed migration cannot be rolled back.",
    fix: "Inject backup step (pg_dump to artifact store) before any psql -f.",
  },
  {
    scriptId: "script-2",
    pattern: "no approval gate on prod DB change",
    severity: "critical",
    description: "DB migration mutates prod with zero human checkpoint.",
    fix: "Inject approval_gate before psql -f.",
  },
  {
    scriptId: "script-4",
    pattern: "rm -rf with environment variable expansion risk",
    severity: "warning",
    description: "rm -rf on /tmp/cache/* is recoverable but the pattern is dangerous if paths drift.",
    fix: "Replace with explicit allowlist of paths; add dry-run flag.",
  },
];

export const mockIncidents: Incident[] = [
  {
    id: "incident-1",
    alertSource: "Datadog",
    alertSummary:
      "Worker queue depth > 10k for 5m on prod-workers (us-east-1).",
    workflowId: "script-3",
    diagnosis:
      "Worker pool stalled on a deadlocked DB connection after the 02:00 maintenance window. Restarting the workers should drain the queue. Health endpoint is currently 502.",
    proposedFix:
      "Run the migrated restart_workers workflow: restart workers, poll /health until 200, report.",
    status: "awaiting_approval",
    createdAt: "2026-05-26T08:14:00Z",
  },
  {
    id: "incident-2",
    alertSource: "PagerDuty",
    alertSummary: "Deploy job stuck on staging — pm2 not responding.",
    workflowId: "script-1",
    diagnosis:
      "pm2 daemon crashed mid-restart on staging. Workflow already includes the approval gate + health check, so a safe retry is appropriate.",
    proposedFix: "Re-run deploy workflow from approval_gate step with fresh build artifact.",
    status: "complete",
    approvedBy: "shanay@requiem.dev",
    approvedAt: "2026-05-26T07:42:00Z",
    createdAt: "2026-05-26T07:39:00Z",
  },
];

export const mockExecutions: ExecutionRecord[] = [
  {
    id: "exec-1",
    workflowId: "script-1",
    startedAt: "2026-05-26T07:42:30Z",
    source: "superplane",
    stepResults: [
      { step: "Snapshot current build", status: "success", durationMs: 820 },
      { step: "Pull latest from main", status: "success", durationMs: 1240 },
      { step: "Build production bundle", status: "success", durationMs: 18400 },
      { step: "Approval gate", status: "success", durationMs: 4200 },
      { step: "Restart application processes", status: "success", durationMs: 2900 },
      { step: "Health check /health", status: "success", durationMs: 1100 },
      { step: "Slack notification", status: "success", durationMs: 240 },
    ],
  },
];

export const mockAgentReasoning: string[] = [
  "Reading scripts/deploy.sh ...",
  "Detected step: git pull origin main -> command",
  "Detected step: npm run build -> deploy",
  "Detected step: pm2 restart app -> command (touches production)",
  "Detected notification: Slack webhook reports 'Deploy succeeded' unconditionally.",
  "Danger: notification fires regardless of restart status. Operators get a lie on failure.",
  "Inserting health_check between restart and notification.",
  "Inserting approval_gate before production restart.",
  "Workflow ready: 7 steps, 2 safety additions, 1 critical danger resolved.",
];
