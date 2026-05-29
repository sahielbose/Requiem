import { randomUUID } from "node:crypto";
import { query } from "./client";
import type {
  AuditEntry,
  BashScript,
  DangerFlag,
  ExecutionRecord,
  Incident,
  IncidentStatus,
  MigrationResult,
} from "../types";

// ---------- scripts ----------

export async function insertScript(script: BashScript): Promise<BashScript> {
  const result = await query<{
    id: string;
    repo_url: string;
    path: string;
    filename: string;
    content: string;
    created_at: Date;
  }>(
    `INSERT INTO scripts (id, repo_url, path, filename, content, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       repo_url = EXCLUDED.repo_url,
       path = EXCLUDED.path,
       filename = EXCLUDED.filename,
       content = EXCLUDED.content
     RETURNING id, repo_url, path, filename, content, created_at`,
    [
      script.id,
      script.repoUrl,
      script.path,
      script.filename,
      script.content,
      script.createdAt,
    ]
  );
  return rowToScript(result.rows[0]);
}

export async function getScript(id: string): Promise<BashScript | null> {
  const result = await query(
    `SELECT id, repo_url, path, filename, content, created_at
       FROM scripts WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? rowToScript(result.rows[0] as ScriptRow) : null;
}

// ---------- migrations ----------

export async function insertMigration(
  result: MigrationResult
): Promise<MigrationResult> {
  await query(
    `INSERT INTO migrations (id, script_id, steps, summary, status)
     VALUES ($1, $2, $3::jsonb, $4, $5)`,
    [
      randomUUID(),
      result.scriptId,
      JSON.stringify(result.steps),
      result.summary,
      result.status,
    ]
  );
  return result;
}

// ---------- dangers ----------

export async function insertDangers(
  flags: DangerFlag[]
): Promise<DangerFlag[]> {
  if (flags.length === 0) return [];
  // bulk insert via unnest for speed + atomicity
  const ids: string[] = [];
  const scriptIds: string[] = [];
  const patterns: string[] = [];
  const severities: string[] = [];
  const descriptions: string[] = [];
  const fixes: string[] = [];

  for (const f of flags) {
    ids.push(randomUUID());
    scriptIds.push(f.scriptId);
    patterns.push(f.pattern);
    severities.push(f.severity);
    descriptions.push(f.description);
    fixes.push(f.fix);
  }

  await query(
    `INSERT INTO dangers (id, script_id, pattern, severity, description, fix)
     SELECT * FROM unnest(
       $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[]
     )`,
    [ids, scriptIds, patterns, severities, descriptions, fixes]
  );

  return flags;
}

// ---------- ledger view ----------

export interface MigrationLedgerEntry {
  script: BashScript;
  migration: MigrationResult;
  dangers: DangerFlag[];
}

export async function getMigrationsWithDangers(): Promise<MigrationLedgerEntry[]> {
  const result = await query<{
    script_id: string;
    repo_url: string;
    path: string;
    filename: string;
    content: string;
    script_created_at: Date;
    steps: unknown;
    summary: string;
    status: "migrated" | "failed";
    migration_created_at: Date | null;
    dangers: unknown;
  }>(
    `SELECT
        s.id           AS script_id,
        s.repo_url,
        s.path,
        s.filename,
        s.content,
        s.created_at   AS script_created_at,
        m.steps,
        m.summary,
        m.status,
        m.created_at   AS migration_created_at,
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object(
            'scriptId', d.script_id,
            'pattern', d.pattern,
            'severity', d.severity,
            'description', d.description,
            'fix', d.fix
          ) ORDER BY d.created_at)
            FROM dangers d
            WHERE d.script_id = s.id),
          '[]'::jsonb
        ) AS dangers
     FROM scripts s
     JOIN LATERAL (
       SELECT steps, summary, status, created_at
         FROM migrations
        WHERE script_id = s.id
        ORDER BY created_at DESC
        LIMIT 1
     ) m ON TRUE
     ORDER BY m.created_at DESC`
  );

  return result.rows.map((r) => ({
    script: {
      id: r.script_id,
      repoUrl: r.repo_url,
      path: r.path,
      filename: r.filename,
      content: r.content,
      createdAt: r.script_created_at.toISOString(),
    },
    migration: {
      scriptId: r.script_id,
      steps: r.steps as MigrationResult["steps"],
      summary: r.summary,
      status: r.status,
    },
    dangers: r.dangers as DangerFlag[],
  }));
}

// ---------- incidents ----------

export async function insertIncident(incident: Incident): Promise<Incident> {
  await query(
    `INSERT INTO incidents
       (id, alert_source, alert_summary, workflow_id, diagnosis,
        proposed_fix, status, approved_by, approved_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO UPDATE SET
       alert_source = EXCLUDED.alert_source,
       alert_summary = EXCLUDED.alert_summary,
       workflow_id = EXCLUDED.workflow_id,
       diagnosis = EXCLUDED.diagnosis,
       proposed_fix = EXCLUDED.proposed_fix,
       status = EXCLUDED.status,
       approved_by = EXCLUDED.approved_by,
       approved_at = EXCLUDED.approved_at`,
    [
      incident.id,
      incident.alertSource,
      incident.alertSummary,
      incident.workflowId,
      incident.diagnosis,
      incident.proposedFix,
      incident.status,
      incident.approvedBy ?? null,
      incident.approvedAt ?? null,
      incident.createdAt,
    ]
  );
  return incident;
}

export async function updateIncidentStatus(
  id: string,
  status: IncidentStatus,
  approvedBy?: string,
  approvedAt?: string
): Promise<Incident | null> {
  const result = await query(
    `UPDATE incidents
        SET status      = $2,
            approved_by = COALESCE($3, approved_by),
            approved_at = COALESCE($4, approved_at)
      WHERE id = $1
      RETURNING id, alert_source, alert_summary, workflow_id, diagnosis,
                proposed_fix, status, approved_by, approved_at, created_at`,
    [id, status, approvedBy ?? null, approvedAt ?? null]
  );
  return result.rows[0] ? rowToIncident(result.rows[0] as IncidentRow) : null;
}

export async function getIncidents(): Promise<Incident[]> {
  const result = await query(
    `SELECT id, alert_source, alert_summary, workflow_id, diagnosis,
            proposed_fix, status, approved_by, approved_at, created_at
       FROM incidents
       ORDER BY created_at DESC`
  );
  return (result.rows as IncidentRow[]).map(rowToIncident);
}

// ---------- executions ----------

export async function insertExecution(
  record: ExecutionRecord
): Promise<ExecutionRecord> {
  await query(
    `INSERT INTO executions (id, workflow_id, step_results, started_at, source)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    [
      record.id,
      record.workflowId,
      JSON.stringify(record.stepResults),
      record.startedAt,
      record.source,
    ]
  );
  return record;
}

export async function getExecutions(): Promise<ExecutionRecord[]> {
  const result = await query<{
    id: string;
    workflow_id: string;
    step_results: ExecutionRecord["stepResults"];
    started_at: Date;
    source: ExecutionRecord["source"];
  }>(
    `SELECT id, workflow_id, step_results, started_at, source
       FROM executions
       ORDER BY started_at DESC`
  );
  return result.rows.map((r) => ({
    id: r.id,
    workflowId: r.workflow_id,
    stepResults: r.step_results,
    startedAt: r.started_at.toISOString(),
    source: r.source,
  }));
}

// ---------- overview stats ----------

export interface OverviewStats {
  totalScripts: number;
  totalMigrations: number;
  totalCriticalDangers: number;
  totalWarningDangers: number;
  incidentsAwaitingApproval: number;
  mostCommonDangerPattern: string | null;
  scriptsWithSafetyGatesAdded: number;
  totalReposScanned: number;
}

export async function getOverviewStats(): Promise<OverviewStats> {
  const result = await query<{
    total_scripts: number;
    total_migrations: number;
    total_critical: number;
    total_warning: number;
    incidents_awaiting: number;
    total_repos: number;
    most_common_pattern: string | null;
    scripts_with_gates: number;
  }>(
    `SELECT
       (SELECT COUNT(*)::int FROM scripts)                         AS total_scripts,
       (SELECT COUNT(*)::int FROM migrations WHERE status = 'migrated') AS total_migrations,
       (SELECT COUNT(*)::int FROM dangers WHERE severity = 'critical') AS total_critical,
       (SELECT COUNT(*)::int FROM dangers WHERE severity = 'warning')  AS total_warning,
       (SELECT COUNT(*)::int FROM incidents WHERE status = 'awaiting_approval') AS incidents_awaiting,
       (SELECT COUNT(DISTINCT repo_url)::int FROM scripts)         AS total_repos,
       (SELECT pattern FROM dangers GROUP BY pattern ORDER BY COUNT(*) DESC LIMIT 1) AS most_common_pattern,
       (
         SELECT COUNT(DISTINCT m.script_id)::int
           FROM migrations m
          WHERE EXISTS (
            SELECT 1
              FROM jsonb_array_elements(m.steps) AS s
             WHERE s->>'original' IN ('(added by danger-audit)', '(added by reviewer)')
          )
       ) AS scripts_with_gates`
  );
  const r = result.rows[0];
  return {
    totalScripts: r.total_scripts ?? 0,
    totalMigrations: r.total_migrations ?? 0,
    totalCriticalDangers: r.total_critical ?? 0,
    totalWarningDangers: r.total_warning ?? 0,
    incidentsAwaitingApproval: r.incidents_awaiting ?? 0,
    mostCommonDangerPattern: r.most_common_pattern ?? null,
    scriptsWithSafetyGatesAdded: r.scripts_with_gates ?? 0,
    totalReposScanned: r.total_repos ?? 0,
  };
}

// ---------- audit log ----------

export async function appendAudit(entry: AuditEntry): Promise<AuditEntry> {
  await query(
    `INSERT INTO audit_log (timestamp, actor, action, detail)
     VALUES ($1, $2, $3, $4)`,
    [entry.timestamp, entry.actor, entry.action, entry.detail]
  );
  return entry;
}

export async function getAuditLog(limit = 200): Promise<AuditEntry[]> {
  const result = await query<{
    timestamp: Date;
    actor: string;
    action: string;
    detail: string;
  }>(
    `SELECT timestamp, actor, action, detail
       FROM audit_log
       ORDER BY timestamp DESC
       LIMIT $1`,
    [limit]
  );
  return result.rows.map((r) => ({
    timestamp: r.timestamp.toISOString(),
    actor: r.actor,
    action: r.action,
    detail: r.detail,
  }));
}

// ---------- row mappers ----------

interface ScriptRow {
  id: string;
  repo_url: string;
  path: string;
  filename: string;
  content: string;
  created_at: Date;
}

function rowToScript(r: ScriptRow): BashScript {
  return {
    id: r.id,
    repoUrl: r.repo_url,
    path: r.path,
    filename: r.filename,
    content: r.content,
    createdAt: r.created_at.toISOString(),
  };
}

interface IncidentRow {
  id: string;
  alert_source: string;
  alert_summary: string;
  workflow_id: string;
  diagnosis: string;
  proposed_fix: string;
  status: IncidentStatus;
  approved_by: string | null;
  approved_at: Date | null;
  created_at: Date;
}

function rowToIncident(r: IncidentRow): Incident {
  return {
    id: r.id,
    alertSource: r.alert_source,
    alertSummary: r.alert_summary,
    workflowId: r.workflow_id,
    diagnosis: r.diagnosis,
    proposedFix: r.proposed_fix,
    status: r.status,
    approvedBy: r.approved_by ?? undefined,
    approvedAt: r.approved_at ? r.approved_at.toISOString() : undefined,
    createdAt: r.created_at.toISOString(),
  };
}
