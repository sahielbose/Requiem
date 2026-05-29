"use client";

import { usePolling } from "@/lib/usePolling";
import { getOverview } from "@/lib/api";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "default" | "critical" | "warning" | "success" | "info";
}

function StatCard({ label, value, sub, accent = "default" }: StatCardProps) {
  const valueColor =
    accent === "critical"
      ? "text-critical"
      : accent === "warning"
      ? "text-warning"
      : accent === "success"
      ? "text-success"
      : accent === "info"
      ? "text-info"
      : "text-text";

  return (
    <div className="rounded-md border border-border bg-panel p-5">
      <div className="text-xs uppercase tracking-widest text-muted">{label}</div>
      <div className={`mt-2 text-3xl font-bold tabular-nums ${valueColor}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

function PipelineDiagram() {
  const stages = [
    { label: "Scan", sub: "GitHub → .sh files" },
    { label: "Migrate", sub: "bash → workflow" },
    { label: "Audit", sub: "danger detection" },
    { label: "Incident", sub: "auto-triage" },
    { label: "Approve", sub: "human gate" },
    { label: "Execute", sub: "safe run" },
  ];

  return (
    <div className="rounded-md border border-border bg-panel p-5">
      <div className="mb-4 text-xs uppercase tracking-widest text-muted">
        Pipeline
      </div>
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {stages.map((s, i) => (
          <div key={s.label} className="flex items-center gap-1">
            <div className="min-w-[80px] rounded-sm border border-border bg-bg px-3 py-2 text-center">
              <div className="text-sm font-medium">{s.label}</div>
              <div className="mt-0.5 text-[10px] text-muted">{s.sub}</div>
            </div>
            {i < stages.length - 1 && (
              <span className="select-none text-muted">→</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function OverviewTab() {
  const { data, loading, error } = usePolling(getOverview, 5000);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-md border border-border bg-panel"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-md border border-border bg-panel p-5 text-sm text-muted">
        {error
          ? `Could not load overview: ${error.message}`
          : "No data yet — scan a repository to get started."}
      </div>
    );
  }

  const securedPct =
    data.totalScripts > 0
      ? Math.round((data.scriptsWithSafetyGatesAdded / data.totalScripts) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Scripts scanned"
          value={data.totalScripts}
          sub={`across ${data.totalReposScanned} repo${data.totalReposScanned === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Critical dangers"
          value={data.totalCriticalDangers}
          sub={`+ ${data.totalWarningDangers} warning${data.totalWarningDangers === 1 ? "" : "s"}`}
          accent={data.totalCriticalDangers > 0 ? "critical" : "default"}
        />
        <StatCard
          label="Incidents pending"
          value={data.incidentsAwaitingApproval}
          sub="awaiting approval"
          accent={data.incidentsAwaitingApproval > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Scripts secured"
          value={`${securedPct}%`}
          sub={`${data.scriptsWithSafetyGatesAdded} of ${data.totalScripts} had gates injected`}
          accent="success"
        />
      </div>

      {data.mostCommonDangerPattern && (
        <div className="rounded-md border border-critical/30 bg-critical/5 p-5">
          <div className="text-xs uppercase tracking-widest text-muted">
            Most common danger pattern
          </div>
          <div className="mt-2 font-mono text-sm text-critical">
            {data.mostCommonDangerPattern}
          </div>
          <div className="mt-1 text-xs text-muted">
            This is the pattern most frequently found across all scanned
            repositories. Prioritise it in your remediation backlog.
          </div>
        </div>
      )}

      <PipelineDiagram />

      <div className="rounded-md border border-border bg-panel p-5">
        <div className="mb-3 text-xs uppercase tracking-widest text-muted">
          What Requiem found
        </div>
        <div className="space-y-2 text-sm">
          {data.totalCriticalDangers > 0 && (
            <div className="flex items-start gap-2">
              <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-critical" />
              <span>
                <span className="font-semibold text-critical">
                  {data.totalCriticalDangers} critical danger
                  {data.totalCriticalDangers === 1 ? "" : "s"}
                </span>{" "}
                across {data.totalScripts} script
                {data.totalScripts === 1 ? "" : "s"} — operations that can
                corrupt data, lie to operators, or cause irrecoverable loss.
              </span>
            </div>
          )}
          {data.totalWarningDangers > 0 && (
            <div className="flex items-start gap-2">
              <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warning" />
              <span>
                <span className="font-semibold text-warning">
                  {data.totalWarningDangers} warning
                  {data.totalWarningDangers === 1 ? "" : "s"}
                </span>{" "}
                — risky but recoverable patterns that should still be gated.
              </span>
            </div>
          )}
          {data.scriptsWithSafetyGatesAdded > 0 && (
            <div className="flex items-start gap-2">
              <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-success" />
              <span>
                <span className="font-semibold text-success">
                  {data.scriptsWithSafetyGatesAdded} script
                  {data.scriptsWithSafetyGatesAdded === 1 ? "" : "s"}
                </span>{" "}
                had approval gates, backups, or health checks automatically
                injected by Requiem.
              </span>
            </div>
          )}
          {data.totalScripts === 0 && (
            <div className="text-muted">
              No scripts scanned yet. Go to the Scan tab and paste a GitHub URL.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
