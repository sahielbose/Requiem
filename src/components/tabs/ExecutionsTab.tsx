"use client";

import { usePolling } from "@/lib/usePolling";
import { getExecutions } from "@/lib/api";

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function ExecutionsTab() {
  const { data, loading } = usePolling(getExecutions, 3000);

  if (loading && !data)
    return <div className="text-sm text-muted">Loading executions...</div>;
  if (!data || data.length === 0)
    return (
      <div className="rounded-md border border-border bg-panel p-5 text-sm text-muted">
        No executions yet.
      </div>
    );

  return (
    <div className="space-y-4">
      {data.map((exec) => (
        <section
          key={exec.id}
          className="rounded-md border border-border bg-panel"
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div>
              <div className="font-mono text-sm">{exec.workflowId}</div>
              <div className="text-xs text-muted">
                started {new Date(exec.startedAt).toLocaleString()}
              </div>
            </div>
            <span
              className={
                "rounded-sm border px-2 py-0.5 font-mono text-[11px] uppercase " +
                (exec.source === "superplane"
                  ? "border-accent/40 bg-accent/15 text-accent"
                  : "border-border bg-bg text-muted")
              }
            >
              source: {exec.source}
            </span>
          </div>
          <ul className="divide-y divide-border">
            {exec.stepResults.map((s, i) => (
              <li
                key={i}
                className="flex items-center justify-between px-5 py-2.5"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[11px] text-muted">
                    #{String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-sm">{s.step}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-muted">
                    {formatDuration(s.durationMs)}
                  </span>
                  <span
                    className={
                      "rounded-sm border px-2 py-0.5 font-mono text-[11px] uppercase " +
                      (s.status === "success"
                        ? "border-success/40 bg-success/15 text-success"
                        : s.status === "failed"
                          ? "border-critical/40 bg-critical/15 text-critical"
                          : "border-border bg-bg text-muted")
                    }
                  >
                    {s.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
