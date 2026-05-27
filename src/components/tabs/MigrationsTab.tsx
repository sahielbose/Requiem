"use client";

import { useState } from "react";
import { usePolling } from "@/lib/usePolling";
import { getMigrations } from "@/lib/api";
import type { DangerSeverity } from "@/lib/types";

const severityClass: Record<DangerSeverity, string> = {
  critical: "bg-critical/15 text-critical border-critical/40",
  warning: "bg-warning/15 text-warning border-warning/40",
  info: "bg-info/15 text-info border-info/40",
};

export function MigrationsTab() {
  const { data, loading } = usePolling(getMigrations, 3000);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (loading && !data)
    return <div className="text-sm text-muted">Loading ledger...</div>;
  if (!data) return null;

  const { migrations, dangers, scripts } = data;

  return (
    <div className="rounded-md border border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold">
          Migration ledger{" "}
          <span className="ml-2 text-muted">({migrations.length})</span>
        </h3>
        <span className="text-xs uppercase tracking-widest text-muted">
          polling every 3s
        </span>
      </div>
      <ul className="divide-y divide-border">
        {migrations.map((m) => {
          const script = scripts.find((s) => s.id === m.scriptId);
          const flags = dangers.filter((d) => d.scriptId === m.scriptId);
          const open = expanded === m.scriptId;
          return (
            <li key={m.scriptId} className="px-5 py-3">
              <button
                onClick={() => setExpanded(open ? null : m.scriptId)}
                className="flex w-full items-center justify-between text-left"
              >
                <div>
                  <div className="font-mono text-sm">
                    {script?.filename ?? m.scriptId}
                  </div>
                  <div className="text-xs text-muted">{m.summary}</div>
                </div>
                <div className="flex items-center gap-3">
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
                  <span className="text-xs text-muted">
                    {open ? "▾" : "▸"}
                  </span>
                </div>
              </button>
              {open && (
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="mb-2 text-xs uppercase tracking-widest text-muted">
                      Workflow steps
                    </div>
                    <ol className="space-y-1.5">
                      {m.steps.map((s) => (
                        <li
                          key={s.order}
                          className="rounded-sm border border-border bg-bg px-3 py-2"
                        >
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-mono text-muted">
                              #{s.order}
                            </span>
                            <span className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted">
                              {s.type}
                            </span>
                          </div>
                          <div className="mt-1 text-sm">{s.description}</div>
                          <div className="mt-1 font-mono text-[11px] text-muted">
                            {s.original}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div>
                    <div className="mb-2 text-xs uppercase tracking-widest text-muted">
                      Danger flags
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
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
