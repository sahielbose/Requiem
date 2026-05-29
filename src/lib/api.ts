import type {
  AuditEntry,
  BashScript,
  DangerFlag,
  ExecutionRecord,
  Incident,
  MigrationResult,
} from "./types";
import type { OverviewStats } from "./db/queries";

export interface ScanJobStatus {
  id: string;
  status: "queued" | "running" | "complete" | "failed";
  progress: {
    total: number;
    processed: number;
    currentScript: string | null;
    currentStep: string | null;
  };
  errors: string[];
  workflows: Array<{
    scriptId: string;
    filename: string;
    workflowId: string;
    canvasUrl: string;
  }>;
}

// Same-origin fetches by default — UI and API share the Next.js process on
// localhost:3000 in dev and on the same Vercel/Render origin in prod.
const API_BASE = "";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `${res.status} ${res.statusText}${txt ? `: ${txt}` : ""}`
    );
  }
  return res.json() as Promise<T>;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- scan ----------

interface ScanResponse {
  jobId: string;
  scriptCount: number;
  fellBackToSeed: boolean;
}

interface JobStatus {
  id: string;
  status: "queued" | "running" | "complete" | "failed";
  progress: {
    total: number;
    processed: number;
    currentScript: string | null;
    currentStep: string | null;
  };
  errors: string[];
  workflows: Array<{
    scriptId: string;
    filename: string;
    workflowId: string;
    canvasUrl: string;
  }>;
}

const SCAN_POLL_INTERVAL_MS = 500;
const SCAN_POLL_TIMEOUT_MS = 120_000;

async function waitForScanComplete(jobId: string): Promise<JobStatus | null> {
  const start = Date.now();
  while (Date.now() - start < SCAN_POLL_TIMEOUT_MS) {
    await delay(SCAN_POLL_INTERVAL_MS);
    const res = await fetch(
      `${API_BASE}/api/scan/status?jobId=${encodeURIComponent(jobId)}`,
      { cache: "no-store" }
    );
    if (!res.ok) continue;
    const job = (await res.json()) as JobStatus;
    if (job.status === "complete" || job.status === "failed") return job;
  }
  return null;
}

export async function startScan(
  url: string
): Promise<{ jobId: string; scriptCount: number; fellBackToSeed: boolean }> {
  const res = await fetch(`${API_BASE}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl: url }),
    cache: "no-store",
  });
  return asJson<ScanResponse>(res);
}

export async function getScanStatus(jobId: string): Promise<ScanJobStatus> {
  const res = await fetch(
    `${API_BASE}/api/scan/status?jobId=${encodeURIComponent(jobId)}`,
    { cache: "no-store" }
  );
  return asJson<ScanJobStatus>(res);
}

export async function scanRepo(url: string): Promise<BashScript[]> {
  const res = await fetch(`${API_BASE}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl: url }),
    cache: "no-store",
  });
  const { jobId } = await asJson<ScanResponse>(res);

  // Wait for the agent pipeline to finish so the ledger we read after this is fresh.
  await waitForScanComplete(jobId);

  // Pull the persisted scripts back out via the ledger view.
  const ledger = await fetchLedger();
  return ledger.map((e) => e.script);
}

// ---------- migrations ----------

interface MigrationLedgerEntry {
  script: BashScript;
  migration: MigrationResult;
  dangers: DangerFlag[];
}

async function fetchLedger(): Promise<MigrationLedgerEntry[]> {
  const res = await fetch(`${API_BASE}/api/migrations`, { cache: "no-store" });
  return asJson<MigrationLedgerEntry[]>(res);
}

export async function getMigrations(): Promise<{
  migrations: MigrationResult[];
  dangers: DangerFlag[];
  scripts: BashScript[];
}> {
  const ledger = await fetchLedger();
  return {
    migrations: ledger.map((e) => e.migration),
    dangers: ledger.flatMap((e) => e.dangers),
    scripts: ledger.map((e) => e.script),
  };
}

// ---------- incidents ----------

export async function getIncidents(): Promise<Incident[]> {
  const res = await fetch(`${API_BASE}/api/incidents`, { cache: "no-store" });
  return asJson<Incident[]>(res);
}

export async function createIncident(scriptId: string): Promise<Incident> {
  const res = await fetch(`${API_BASE}/api/incidents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scriptId }),
    cache: "no-store",
  });
  return asJson<Incident>(res);
}

export async function approveIncident(
  id: string,
  approver: string
): Promise<Incident> {
  const res = await fetch(`${API_BASE}/api/incidents/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, approver }),
    cache: "no-store",
  });
  const data = await asJson<{
    incident: Incident;
    execution: ExecutionRecord | null;
  }>(res);
  return data.incident;
}

// ---------- executions ----------

export async function getExecutions(): Promise<ExecutionRecord[]> {
  const res = await fetch(`${API_BASE}/api/executions`, { cache: "no-store" });
  return asJson<ExecutionRecord[]>(res);
}

// ---------- overview ----------

export async function getOverview(): Promise<OverviewStats> {
  const res = await fetch(`${API_BASE}/api/overview`, { cache: "no-store" });
  return asJson<OverviewStats>(res);
}

// ---------- audit log ----------

export async function getAuditLogEntries(): Promise<AuditEntry[]> {
  const res = await fetch(`${API_BASE}/api/audit`, { cache: "no-store" });
  return asJson<AuditEntry[]>(res);
}

// ---------- export ----------

export function exportReportUrl(repoUrl?: string): string {
  if (repoUrl) {
    return `${API_BASE}/api/export?repo=${encodeURIComponent(repoUrl)}`;
  }
  return `${API_BASE}/api/export`;
}
