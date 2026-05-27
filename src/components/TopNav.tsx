"use client";

import type { TabKey } from "./tabs/types";

const tabs: { key: TabKey; label: string }[] = [
  { key: "scan", label: "Scan" },
  { key: "migrations", label: "Migrations" },
  { key: "incidents", label: "Incidents" },
  { key: "executions", label: "Executions" },
];

export function TopNav({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (k: TabKey) => void;
}) {
  return (
    <header className="border-b border-border bg-panel/60 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-sm border border-border bg-bg font-mono text-sm font-bold tracking-tight">
            R
          </div>
          <div>
            <div className="text-sm font-semibold tracking-wide">Requiem</div>
            <div className="text-[11px] uppercase tracking-widest text-muted">
              Bash script funeral
            </div>
          </div>
        </div>
        <nav className="flex items-center gap-1">
          {tabs.map((t) => {
            const isActive = active === t.key;
            return (
              <button
                key={t.key}
                onClick={() => onChange(t.key)}
                className={
                  "rounded-sm px-3 py-1.5 text-sm transition " +
                  (isActive
                    ? "bg-bg text-text ring-1 ring-border"
                    : "text-muted hover:text-text")
                }
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
