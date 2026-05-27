"use client";

import { useEffect, useState } from "react";

interface AgentReasoningProps {
  lines: string[];
  title?: string;
  intervalMs?: number;
}

export function AgentReasoning({
  lines,
  title = "Agent reasoning",
  intervalMs = 350,
}: AgentReasoningProps) {
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    setVisibleCount(0);
    if (lines.length === 0) return;
    const id = setInterval(() => {
      setVisibleCount((c) => {
        if (c >= lines.length) {
          clearInterval(id);
          return c;
        }
        return c + 1;
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [lines, intervalMs]);

  return (
    <div className="rounded-md border border-border bg-panel p-4 font-mono text-sm">
      <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-wider text-muted">
        <span>{title}</span>
        <span>
          {visibleCount}/{lines.length}
        </span>
      </div>
      <div className="space-y-1.5">
        {lines.slice(0, visibleCount).map((line, i) => (
          <div
            key={i}
            className="animate-[fadeIn_300ms_ease-out] text-text/90"
            style={{ animation: "fadeIn 300ms ease-out" }}
          >
            <span className="mr-2 select-none text-muted">{">"}</span>
            {line}
          </div>
        ))}
        {visibleCount < lines.length && (
          <div className="text-muted">
            <span className="mr-2">{">"}</span>
            <span className="inline-block h-3 w-2 animate-pulse bg-muted align-middle" />
          </div>
        )}
      </div>
      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(2px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

export default AgentReasoning;
