"use client";

import { usePolling } from "@/lib/usePolling";
import { getAuditLogEntries } from "@/lib/api";
import type { AuditEntry } from "@/lib/types";

const ACTOR_STYLES: Record<string, string> = {
  "migration-agent": "border-info/40 bg-info/10 text-info",
  "danger-audit-agent": "border-critical/40 bg-critical/10 text-critical",
  "incident-agent": "border-warning/40 bg-warning/10 text-warning",
  "reviewer-agent": "border-accent/40 bg-accent/10 text-accent",
  worker: "border-border bg-bg text-muted",
  seed: "border-border bg-bg text-muted",
};

const ACTION_ICONS: Record<string, string> = {
  migrate_script: "→",
  audit_script: "⚑",
  create_incident: "!",
  review_passed: "✓",
  review_issues: "⚠",
  scan_start: "▶",
  scan_complete: "✔",
  approve_incident: "▲",
  insert_scripts: "↑",
};

function actorStyle(actor: string): string {
  // approvals come from email addresses
  if (actor.includes("@")) return "border-success/40 bg-success/10 text-success";
  return ACTOR_STYLES[actor] ?? "border-border bg-bg text-muted";
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function groupByDay(entries: AuditEntry[]): { date: string; entries: AuditEntry[] }[] {
  const map = new Map<string, AuditEntry[]>();
  for (const e of entries) {
    const day = new Date(e.timestamp).toDateString();
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(e);
  }
  return Array.from(map.entries()).map(([date, entries]) => ({ date, entries }));
}

export function AuditTab() {
  const { data, loading, error } = usePolling(getAuditLogEntries, 3000);

  if (loading && !data) {
    return <div className="text-sm text-muted">Loading audit log...</div>;
  }

  if (error || !data) {
    return (
      <div className="rounded-md border border-border bg-panel p-5 text-sm text-muted">
        {error
          ? `Could not load audit log: ${error.message}`
          : "No activity yet."}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-md border border-border bg-panel p-5 text-sm text-muted">
        No activity recorded yet. Scan a repository to start generating audit
        entries.
      </div>
    );
  }

  const groups = groupByDay(data);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Activity timeline</h2>
          <p className="mt-0.5 text-xs text-muted">
            Every agent action, human approval, and pipeline event — in order.
          </p>
        </div>
        <span className="rounded-sm border border-border px-2 py-0.5 font-mono text-[11px] text-muted">
          {data.length} entries · polling 3s
        </span>
      </div>

      {groups.map(({ date, entries }) => (
        <div key={date}>
          <div className="mb-3 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-widest text-muted">
              {formatDate(entries[0].timestamp)}
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="rounded-md border border-border bg-panel">
            <ul className="divide-y divide-border">
              {entries.map((e, i) => {
                const icon = ACTION_ICONS[e.action] ?? "·";
                const style = actorStyle(e.actor);
                return (
                  <li key={i} className="flex items-start gap-4 px-5 py-3">
                    <span className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-muted">
                      {formatTs(e.timestamp)}
                    </span>
                    <span
                      className={
                        "shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] " +
                        style
                      }
                    >
                      {e.actor}
                    </span>
                    <span className="shrink-0 select-none text-muted">{icon}</span>
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-xs text-muted">
                        {e.action}
                      </span>
                      <div className="mt-0.5 truncate text-sm text-text/90">
                        {e.detail}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}
