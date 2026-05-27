"use client";

import { useState } from "react";
import { scanRepo } from "@/lib/api";
import type { BashScript } from "@/lib/types";
import { AgentReasoning } from "@/components/AgentReasoning";
import { mockAgentReasoning } from "@/lib/mockData";

export function ScanTab() {
  const [url, setUrl] = useState("https://github.com/example/legacy-ops");
  const [scripts, setScripts] = useState<BashScript[]>([]);
  const [scanning, setScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);

  const onScan = async () => {
    setScanning(true);
    const res = await scanRepo(url);
    setScripts(res);
    setHasScanned(true);
    setScanning(false);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-panel p-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">
          Scan a repository
        </h2>
        <p className="mt-1 text-sm text-muted">
          Paste a public GitHub URL. Requiem will find every <code className="font-mono text-text">.sh</code>{" "}
          file and surface them for migration.
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

      {hasScanned && (
        <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="rounded-md border border-border bg-panel">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h3 className="text-sm font-semibold">
                Found scripts{" "}
                <span className="ml-2 text-muted">({scripts.length})</span>
              </h3>
              <span className="text-xs uppercase tracking-widest text-muted">
                {url.replace(/^https?:\/\//, "")}
              </span>
            </div>
            <ul className="divide-y divide-border">
              {scripts.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between px-5 py-3"
                >
                  <div>
                    <div className="font-mono text-sm">{s.filename}</div>
                    <div className="font-mono text-xs text-muted">{s.path}</div>
                  </div>
                  <span className="rounded-sm border border-border px-2 py-0.5 font-mono text-[11px] text-muted">
                    queued
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <AgentReasoning lines={mockAgentReasoning} title="Migration agent" />
        </section>
      )}
    </div>
  );
}
