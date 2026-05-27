export interface BashScript {
  id: string;
  repoUrl: string;
  path: string;
  filename: string;
  content: string;
  createdAt: string;
}

export interface WorkflowStep {
  order: number;
  type:
    | "command"
    | "deploy"
    | "db_migration"
    | "health_check"
    | "notification"
    | "approval_gate"
    | "backup";
  description: string;
  original: string;
}

export interface MigrationResult {
  scriptId: string;
  steps: WorkflowStep[];
  summary: string;
  status: "migrated" | "failed";
}

export type DangerSeverity = "critical" | "warning" | "info";

export interface DangerFlag {
  scriptId: string;
  pattern: string;
  severity: DangerSeverity;
  description: string;
  fix: string;
}

export type IncidentStatus =
  | "diagnosing"
  | "awaiting_approval"
  | "approved"
  | "running"
  | "complete"
  | "failed";

export interface Incident {
  id: string;
  alertSource: string;
  alertSummary: string;
  workflowId: string;
  diagnosis: string;
  proposedFix: string;
  status: IncidentStatus;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
}

export interface ExecutionStepResult {
  step: string;
  status: "success" | "failed" | "skipped";
  durationMs: number;
}

export interface ExecutionRecord {
  id: string;
  workflowId: string;
  stepResults: ExecutionStepResult[];
  startedAt: string;
  source: "superplane" | "local_log";
}

export interface AuditEntry {
  timestamp: string;
  actor: string;
  action: string;
  detail: string;
}
