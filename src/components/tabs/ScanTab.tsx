"use client";

import { useEffect, useRef, useState } from "react";
import { startScan, getScanStatus } from "@/lib/api";
import type { BashScript } from "@/lib/types";
import type { ScanJobStatus } from "@/lib/api";

const STEP_LABELS: Record<string, string> = {
  insert_script: "persisting script",
  migration_agent: "running migration agent (Claude)",
  danger_audit_agent: "running danger audit agent",
  reviewer_agent: "running reviewer agent (self-critique)",
  persist_migration: "persisting workflow",
  push_workflow: "pushing to SuperPlane",
  incident_agent: "running incident agent",
};

interface ScriptState {
  script: BashScript;
  status: "done" | "failed";
}

function LiveReasoning({
  lines,
  title,
}: {
  lines: string[];
  title: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines.length]);

  return (
    <div className="rounded-md border border-border bg-panel p-4 font-mono text-sm">
      <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-wider text-muted">
        <span>{title}</span>
        <span className="tabular-nums">{lines.length} lines</span>
      </div>
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {lines.map((line, i) => (
          <div key={i} className="text-text/90">
            <span className="mr-2 select-none text-muted">{">"}</span>
            {line}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

export function ScanTab() {
  const [url, setUrl] = useState("https://github.com/example/legacy-ops");
  const [scriptStates, setScriptStates] = useState<ScriptState[]>([]);
  const [scanning, setScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [jobStatus, setJobStatus] = useState<ScanJobStatus | null>(null);

  const appendLine = (l: string) => setLines((prev) => [...prev, l]);

  const onScan = async () => {
    setScanning(true);
    setHasScanned(false);
    setScriptStates([]);
    setLines([]);
    setJobStatus(null);

    try {
      appendLine(`Contacting GitHub: ${url}`);

      const { jobId, scriptCount, fellBackToSeed } = await startScan(url);

      if (fellBackToSeed) {
        appendLine("GitHub unreachable or no .sh files found — using seed scripts.");
      } else {
        appendLine(`Found ${scriptCount} script(s) in repository.`);
      }
      appendLine(`Job ${jobId} enqueued. Starting agent pipeline...`);

      let lastScript: string | null = null;
      let lastStep: string | null = null;
      const deadline = Date.now() + 120_000;

      while (Date.now() < deadline) {
        await new Promise<void>((r) => setTimeout(r, 500));

        let job: ScanJobStatus;
        try {
          job = await getScanStatus(jobId);
        } catch {
          continue;
        }

        setJobStatus(job);

        if (
          job.progress.currentScript !== lastScript &&
          job.progress.currentScript
        ) {
          appendLine(`▶ ${job.progress.currentScript}`);
          lastScript = job.progress.currentScript;
          lastStep = null;
        }

        if (
          job.progress.currentStep !== lastStep &&
          job.progress.currentStep
        ) {
          const label =
            STEP_LABELS[job.progress.currentStep] ?? job.progress.currentStep;
          appendLine(`    ↳ ${label} ...`);
          lastStep = job.progress.currentStep;
        }

        if (job.status === "complete" || job.status === "failed") {
          if (job.status === "complete") {
            appendLine(
              `Pipeline complete: ${job.progress.processed}/${job.progress.total} script(s) migrated.`
            );
            for (const wf of job.workflows) {
              appendLine(`  ✔ ${wf.filename} → ${wf.workflowId}`);
            }
            if (job.errors.length > 0) {
              appendLine(`  ${job.errors.length} non-fatal error(s).`);
            }
          } else {
            appendLine(`Pipeline failed: ${job.errors.join("; ")}`);
          }
          break;
        }
      }

      // Fetch final ledger
      const ledgerRes = await fetch("/api/migrations", { cache: "no-store" });
      if (ledgerRes.ok) {
        const ledger = (await ledgerRes.json()) as Array<{
          script: BashScript;
        }>;
        setScriptStates(
          ledger.map((e) => ({ script: e.script, status: "done" }))
        );
      }
      setHasScanned(true);
    } catch (err) {
      appendLine(
        `Error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setScanning(false);
    }
  };

  const showPanel = scanning || hasScanned;

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-panel p-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">
          Scan a repository
        </h2>
        <p className="mt-1 text-sm text-muted">
          Paste a public GitHub URL. Requiem will find every{" "}
          <code className="font-mono text-text">.sh</code> file and run it
          through the full agent pipeline.
        </p>
        <div className="mt-4 flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/org/repo"
            className="flex-1 rounded-sm border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            onClick={onScan}
            disabled={scanning || !url}
            className="rounded-sm bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {scanning ? "Scanning..." : "Scan repository"}
          </button>
        </div>
      </section>

      {showPanel && (
        <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="rounded-md border border-border bg-panel">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h3 className="text-sm font-semibold">
                {hasScanned ? (
                  <>
                    Scripts migrated{" "}
                    <span className="ml-2 text-muted">
                      ({scriptStates.length})
                    </span>
                  </>
                ) : (
                  "Agent pipeline running"
                )}
              </h3>
              {jobStatus && (
                <span className="text-xs tabular-nums text-muted">
                  {jobStatus.progress.processed}/{jobStatus.progress.total}{" "}
                  processed
                </span>
              )}
            </div>

            {scriptStates.length > 0 ? (
              <ul className="divide-y divide-border">
                {scriptStates.map(({ script, status }) => (
                  <li
                    key={script.id}
                    className="flex items-center justify-between px-5 py-3"
                  >
                    <div>
                      <div className="font-mono text-sm">{script.filename}</div>
                      <div className="font-mono text-xs text-muted">
                        {script.path}
                      </div>
                    </div>
                    <span
                      className={
                        "rounded-sm border px-2 py-0.5 font-mono text-[11px] " +
                        (status === "done"
                          ? "border-success/40 bg-success/15 text-success"
                          : "border-critical/40 bg-critical/15 text-critical")
                      }
                    >
                      {status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-3 px-5 py-6 text-sm text-muted">
                {scanning && (
                  <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-accent" />
                )}
                {scanning
                  ? "Processing scripts through migration → audit → incident pipeline..."
                  : "No scripts found."}
              </div>
            )}
          </div>

          <LiveReasoning lines={lines} title="Agent pipeline" />
        </section>
      )}
    </div>
  );
}
