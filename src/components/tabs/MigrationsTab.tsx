"use client";

import { useState } from "react";
import { usePolling } from "@/lib/usePolling";
import { getMigrations, createIncident, exportReportUrl } from "@/lib/api";
import type { DangerFlag, DangerSeverity, WorkflowStep } from "@/lib/types";

// ---------- helpers ----------

const severityClass: Record<DangerSeverity, string> = {
  critical: "bg-critical/15 text-critical border-critical/40",
  warning: "bg-warning/15 text-warning border-warning/40",
  info: "bg-info/15 text-info border-info/40",
};

function computeRiskScore(flags: DangerFlag[]): number {
  const raw = flags.reduce((s, f) => {
    if (f.severity === "critical") return s + 2.5;
    if (f.severity === "warning") return s + 1.0;
    return s + 0.2;
  }, 0);
  return Math.min(10, Math.round(raw * 10) / 10);
}

function riskColor(score: number): string {
  if (score >= 7) return "text-critical border-critical/40 bg-critical/10";
  if (score >= 4) return "text-warning border-warning/40 bg-warning/10";
  return "text-success border-success/40 bg-success/10";
}

function reviewerStatus(steps: WorkflowStep[]): { passed: boolean; detail: string } {
  const gaps: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const before = steps.slice(Math.max(0, i - 2), i).map((x) => x.type);
    if ((s.type === "deploy" || s.type === "db_migration") && !before.includes("approval_gate")) {
      gaps.push(`step ${s.order} [${s.type}] lacks approval gate`);
    }
    if (s.type === "notification" && !before.includes("health_check")) {
      gaps.push(`step ${s.order} [notification] may fire without health check`);
    }
    if (s.type === "db_migration" && !before.includes("backup")) {
      gaps.push(`step ${s.order} [db_migration] has no backup before it`);
    }
  }
  if (gaps.length === 0) return { passed: true, detail: "All safety invariants hold." };
  return { passed: false, detail: gaps.slice(0, 2).join("; ") };
}

function hasLiePattern(flags: DangerFlag[]): boolean {
  return flags.some(
    (f) =>
      f.pattern.toLowerCase().includes("notification") ||
      f.description.toLowerCase().includes("lie") ||
      f.description.toLowerCase().includes("unconditional")
  );
}

// ---------- sub-components ----------

function RiskBadge({ score }: { score: number }) {
  return (
    <span
      className={
        "rounded-sm border px-2 py-0.5 font-mono text-[11px] tabular-nums " +
        riskColor(score)
      }
      title={`Risk score: ${score}/10`}
    >
      risk {score}/10
    </span>
  );
}

function ReviewerBadge({ steps }: { steps: WorkflowStep[] }) {
  const { passed, detail } = reviewerStatus(steps);
  return (
    <span
      className={
        "rounded-sm border px-2 py-0.5 font-mono text-[11px] " +
        (passed
          ? "border-success/40 bg-success/10 text-success"
          : "border-warning/40 bg-warning/10 text-warning")
      }
      title={detail}
    >
      {passed ? "✓ reviewer" : "⚠ reviewer"}
    </span>
  );
}

function LiesBanner({ flags }: { flags: DangerFlag[] }) {
  const flag = flags.find(
    (f) =>
      f.pattern.toLowerCase().includes("notification") ||
      f.description.toLowerCase().includes("lie") ||
      f.description.toLowerCase().includes("unconditional")
  );
  if (!flag) return null;
  return (
    <div className="mb-4 rounded-sm border border-critical/40 bg-critical/8 px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-critical">
        <span>⚠ This script lies to operators</span>
      </div>
      <div className="mt-1 text-xs text-text/80">
        {flag.description}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-sm border border-critical/30 bg-bg px-3 py-2">
          <div className="mb-1 font-mono uppercase tracking-widest text-muted">Before</div>
          <div className="font-mono text-critical/80">
            notification fires unconditionally — reports success even when
            prior steps failed
          </div>
        </div>
        <div className="rounded-sm border border-success/30 bg-bg px-3 py-2">
          <div className="mb-1 font-mono uppercase tracking-widest text-muted">After Requiem</div>
          <div className="font-mono text-success/80">
            health_check gates the notification — reports what actually happened
          </div>
        </div>
      </div>
    </div>
  );
}

function ImpactSummary({
  steps,
  flags,
}: {
  steps: WorkflowStep[];
  flags: DangerFlag[];
}) {
  const added = steps.filter(
    (s) =>
      s.original === "(added by danger-audit)" ||
      s.original === "(added by reviewer)"
  );
  const gates = added.filter((s) => s.type === "approval_gate").length;
  const backups = added.filter((s) => s.type === "backup").length;
  const health = added.filter((s) => s.type === "health_check").length;
  const critical = flags.filter((f) => f.severity === "critical").length;
  const warning = flags.filter((f) => f.severity === "warning").length;

  if (added.length === 0 && flags.length === 0) return null;

  return (
    <div className="mb-4 rounded-sm border border-accent/30 bg-accent/5 px-4 py-3">
      <div className="mb-2 text-xs uppercase tracking-widest text-muted">
        Requiem impact
      </div>
      <div className="flex flex-wrap gap-4 text-xs">
        {critical > 0 && (
          <span>
            <span className="text-critical">
              {critical} critical
            </span>{" "}
            danger{critical === 1 ? "" : "s"} found
          </span>
        )}
        {warning > 0 && (
          <span>
            <span className="text-warning">{warning} warning</span>
            {warning === 1 ? "" : "s"} found
          </span>
        )}
        {gates > 0 && (
          <span>
            <span className="text-success">{gates} approval gate</span>
            {gates === 1 ? "" : "s"} injected
          </span>
        )}
        {backups > 0 && (
          <span>
            <span className="text-success">{backups} backup step</span>
            {backups === 1 ? "" : "s"} injected
          </span>
        )}
        {health > 0 && (
          <span>
            <span className="text-success">{health} health check</span>
            {health === 1 ? "" : "s"} injected
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- main component ----------

export function MigrationsTab() {
  const { data, loading } = usePolling(getMigrations, 3000);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [incidentPending, setIncidentPending] = useState<string | null>(null);
  const [incidentCreated, setIncidentCreated] = useState<Record<string, boolean>>({});

  const onCreateIncident = async (scriptId: string) => {
    setIncidentPending(scriptId);
    try {
      await createIncident(scriptId);
      setIncidentCreated((prev) => ({ ...prev, [scriptId]: true }));
    } catch (err) {
      console.error("createIncident failed:", err);
    } finally {
      setIncidentPending(null);
    }
  };

  if (loading && !data)
    return <div className="text-sm text-muted">Loading ledger...</div>;
  if (!data) return null;

  const { migrations, dangers, scripts } = data;

  // Collect unique repos for export
  const repos = Array.from(new Set(scripts.map((s) => s.repoUrl))).filter(Boolean);
  const exportUrl = repos.length === 1 ? exportReportUrl(repos[0]) : exportReportUrl();

  return (
    <div className="rounded-md border border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold">
          Migration ledger{" "}
          <span className="ml-2 text-muted">({migrations.length})</span>
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-widest text-muted">
            polling every 3s
          </span>
          {migrations.length > 0 && (
            <a
              href={exportUrl}
              download
              className="rounded-sm border border-border bg-bg px-2 py-0.5 font-mono text-[11px] text-muted transition hover:text-text"
            >
              ↓ export .md
            </a>
          )}
        </div>
      </div>

      {migrations.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-muted">
          No migrations yet — scan a repository first.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {migrations.map((m) => {
            const script = scripts.find((s) => s.id === m.scriptId);
            const flags = dangers.filter((d) => d.scriptId === m.scriptId);
            const open = expanded === m.scriptId;
            const score = computeRiskScore(flags);
            const lies = hasLiePattern(flags);

            return (
              <li key={m.scriptId} className="px-5 py-3">
                <button
                  onClick={() => setExpanded(open ? null : m.scriptId)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div className="min-w-0 flex-1 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">
                        {script?.filename ?? m.scriptId}
                      </span>
                      {lies && (
                        <span
                          className="rounded-sm border border-critical/50 bg-critical/10 px-1.5 py-0.5 font-mono text-[10px] text-critical"
                          title="Sends notifications unconditionally — lies to operators on failure"
                        >
                          ⚠ lies
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted">{m.summary}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <RiskBadge score={score} />
                    <ReviewerBadge steps={m.steps} />
                    <span
                      className={
                        "rounded-sm border px-2 py-0.5 font-mono text-[11px] " +
                        (m.status === "migrated"
                          ? "border-success/40 bg-success/15 text-success"
                          : "border-critical/40 bg-critical/15 text-critical")
                      }
                    >
                      {m.status}
                    </span>
                    <span className="rounded-sm border border-border bg-bg px-2 py-0.5 font-mono text-[11px] text-muted">
                      {flags.length} danger{flags.length === 1 ? "" : "s"}
                    </span>
                    <span className="text-xs text-muted">{open ? "▾" : "▸"}</span>
                  </div>
                </button>

                {open && (
                  <div className="mt-4 space-y-4">
                    <LiesBanner flags={flags} />
                    <ImpactSummary steps={m.steps} flags={flags} />

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div>
                        <div className="mb-2 text-xs uppercase tracking-widest text-muted">
                          Workflow steps
                        </div>
                        <ol className="space-y-1.5">
                          {m.steps.map((s) => {
                            const isAdded =
                              s.original === "(added by danger-audit)" ||
                              s.original === "(added by reviewer)";
                            return (
                              <li
                                key={s.order}
                                className={
                                  "rounded-sm border px-3 py-2 " +
                                  (isAdded
                                    ? "border-success/30 bg-success/5"
                                    : "border-border bg-bg")
                                }
                              >
                                <div className="flex items-center gap-2 text-xs">
                                  <span className="font-mono text-muted">
                                    #{s.order}
                                  </span>
                                  <span className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted">
                                    {s.type}
                                  </span>
                                  {isAdded && (
                                    <span className="font-mono text-[10px] text-success">
                                      ✦ requiem
                                    </span>
                                  )}
                                </div>
                                <div className="mt-1 text-sm">{s.description}</div>
                                {!isAdded && (
                                  <div className="mt-1 font-mono text-[11px] text-muted">
                                    {s.original}
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      </div>

                      <div>
                        <div className="mb-2 flex items-center justify-between">
                          <div className="text-xs uppercase tracking-widest text-muted">
                            Danger flags
                          </div>
                          {flags.some((f) => f.severity === "critical") && (
                            <button
                              onClick={() => onCreateIncident(m.scriptId)}
                              disabled={
                                incidentPending === m.scriptId ||
                                incidentCreated[m.scriptId]
                              }
                              className="rounded-sm border border-critical/40 bg-critical/10 px-2 py-0.5 font-mono text-[11px] text-critical transition hover:bg-critical/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {incidentCreated[m.scriptId]
                                ? "✔ incident created"
                                : incidentPending === m.scriptId
                                ? "creating..."
                                : "create incident"}
                            </button>
                          )}
                        </div>
                        {flags.length === 0 ? (
                          <div className="rounded-sm border border-border bg-bg px-3 py-2 text-sm text-muted">
                            Clean — no issues flagged.
                          </div>
                        ) : (
                          <ul className="space-y-2">
                            {flags.map((f, i) => (
                              <li
                                key={i}
                                className={
                                  "rounded-sm border px-3 py-2 " +
                                  severityClass[f.severity]
                                }
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-mono text-xs uppercase tracking-widest">
                                    {f.severity}
                                  </span>
                                  <span className="font-mono text-[11px] opacity-70">
                                    {f.pattern}
                                  </span>
                                </div>
                                <div className="mt-1 text-sm text-text">
                                  {f.description}
                                </div>
                                <div className="mt-1 text-xs text-text/80">
                                  Fix: {f.fix}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
