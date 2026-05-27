"use client";

import { useEffect, useState } from "react";
import { approveIncident, getIncidents } from "@/lib/api";
import type { Incident, IncidentStatus } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

const statusClass: Record<IncidentStatus, string> = {
  diagnosing: "border-info/40 bg-info/15 text-info",
  awaiting_approval: "border-warning/40 bg-warning/15 text-warning",
  approved: "border-info/40 bg-info/15 text-info",
  running: "border-info/40 bg-info/15 text-info",
  complete: "border-success/40 bg-success/15 text-success",
  failed: "border-critical/40 bg-critical/15 text-critical",
};

export function IncidentsTab() {
  const { data: incidents, loading } = usePolling(getIncidents, 3000);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [override, setOverride] = useState<Record<string, Incident>>({});

  useEffect(() => {
    if (incidents && incidents.length > 0 && !selectedId) {
      setSelectedId(incidents[0].id);
    }
  }, [incidents, selectedId]);

  if (loading && !incidents)
    return <div className="text-sm text-muted">Loading incidents...</div>;
  if (!incidents) return null;

  const merged = incidents.map((i) => override[i.id] ?? i);
  const selected = merged.find((i) => i.id === selectedId) ?? merged[0];

  const onApprove = async () => {
    if (!selected) return;
    const updated = await approveIncident(selected.id, "shanay@requiem.dev");
    setOverride((o) => ({ ...o, [selected.id]: updated }));
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <aside className="rounded-md border border-border bg-panel">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">
          Incidents
        </div>
        <ul className="divide-y divide-border">
          {merged.map((i) => (
            <li key={i.id}>
              <button
                onClick={() => setSelectedId(i.id)}
                className={
                  "w-full px-4 py-3 text-left transition " +
                  (selected?.id === i.id ? "bg-bg" : "hover:bg-bg/60")
                }
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted">
                    {i.alertSource}
                  </span>
                  <span
                    className={
                      "rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase " +
                      statusClass[i.status]
                    }
                  >
                    {i.status.replace("_", " ")}
                  </span>
                </div>
                <div className="mt-1 line-clamp-2 text-sm">
                  {i.alertSummary}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {selected && (
        <section className="rounded-md border border-border bg-panel p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted">
                {selected.alertSource} · {new Date(selected.createdAt).toLocaleString()}
              </div>
              <h2 className="mt-1 text-base font-semibold">
                {selected.alertSummary}
              </h2>
            </div>
            <span
              className={
                "rounded-sm border px-2 py-0.5 font-mono text-[11px] uppercase " +
                statusClass[selected.status]
              }
            >
              {selected.status.replace("_", " ")}
            </span>
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <div className="mb-1 text-xs uppercase tracking-widest text-muted">
                Diagnosis
              </div>
              <div className="rounded-sm border border-border bg-bg px-3 py-2 text-sm">
                {selected.diagnosis}
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs uppercase tracking-widest text-muted">
                Proposed fix
              </div>
              <div className="rounded-sm border border-border bg-bg px-3 py-2 text-sm">
                {selected.proposedFix}
              </div>
            </div>
            {selected.approvedBy && (
              <div className="rounded-sm border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
                Approved by {selected.approvedBy}
                {selected.approvedAt
                  ? ` · ${new Date(selected.approvedAt).toLocaleString()}`
                  : ""}
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={onApprove}
              disabled={selected.status !== "awaiting_approval"}
              className="rounded-sm bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Approve &amp; run
            </button>
            <span className="text-xs text-muted">
              One human tap before Requiem touches prod.
            </span>
          </div>
        </section>
      )}
    </div>
  );
}
