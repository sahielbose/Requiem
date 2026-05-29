import { getMigrationsWithDangers } from "@/lib/db/queries";
import type { DangerFlag } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function riskScore(flags: DangerFlag[]): number {
  const raw = flags.reduce((s, f) => {
    if (f.severity === "critical") return s + 2.5;
    if (f.severity === "warning") return s + 1.0;
    return s + 0.2;
  }, 0);
  return Math.min(10, Math.round(raw * 10) / 10);
}

function riskLabel(score: number): string {
  if (score >= 7) return "HIGH";
  if (score >= 4) return "MEDIUM";
  return "LOW";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repoFilter = url.searchParams.get("repo") ?? undefined;

  let ledger;
  try {
    ledger = await getMigrationsWithDangers();
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "db error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  if (repoFilter) {
    ledger = ledger.filter((e) => e.script.repoUrl === repoFilter);
  }

  const totalCritical = ledger.flatMap((e) => e.dangers).filter((d) => d.severity === "critical").length;
  const totalWarning = ledger.flatMap((e) => e.dangers).filter((d) => d.severity === "warning").length;
  const totalAdded = ledger
    .flatMap((e) => e.migration.steps)
    .filter((s) => s.original === "(added by danger-audit)" || s.original === "(added by reviewer)").length;

  const lines: string[] = [
    `# Requiem Migration Report`,
    ``,
    `> Generated ${new Date().toUTCString()}`,
    repoFilter ? `> Repository: ${repoFilter}` : `> Scope: all repositories`,
    ``,
    `---`,
    ``,
    `## Summary`,
    ``,
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Scripts analysed | ${ledger.length} |`,
    `| Critical dangers found | ${totalCritical} |`,
    `| Warning dangers found | ${totalWarning} |`,
    `| Safety steps injected | ${totalAdded} |`,
    ``,
    `---`,
    ``,
  ];

  for (const { script, migration, dangers } of ledger) {
    const score = riskScore(dangers);
    const label = riskLabel(score);
    const critical = dangers.filter((d) => d.severity === "critical");
    const added = migration.steps.filter(
      (s) => s.original === "(added by danger-audit)" || s.original === "(added by reviewer)"
    );
    const liesFlag = dangers.find((d) =>
      d.pattern.toLowerCase().includes("notification") ||
      d.description.toLowerCase().includes("lie")
    );

    lines.push(`## \`${script.filename}\``);
    lines.push(``);
    lines.push(`**Path:** \`${script.path}\``);
    lines.push(`**Risk score:** ${score}/10 (${label})`);
    if (liesFlag) {
      lines.push(`**⚠ This script lies to operators** — it sends a success notification unconditionally.`);
    }
    lines.push(`**Summary:** ${migration.summary}`);
    lines.push(``);

    if (dangers.length > 0) {
      lines.push(`### Danger flags`);
      lines.push(``);
      for (const d of dangers) {
        lines.push(`- **[${d.severity.toUpperCase()}]** \`${d.pattern}\``);
        lines.push(`  - ${d.description}`);
        lines.push(`  - *Fix:* ${d.fix}`);
      }
      lines.push(``);
    }

    lines.push(`### Migrated workflow (${migration.steps.length} steps, ${added.length} injected by Requiem)`);
    lines.push(``);
    for (const s of migration.steps) {
      const isAdded =
        s.original === "(added by danger-audit)" || s.original === "(added by reviewer)";
      const tag = isAdded ? " ✦" : "";
      lines.push(`${s.order}. **[${s.type}]** ${s.description}${tag}`);
    }
    if (added.length > 0) {
      lines.push(``);
      lines.push(`> ✦ = step injected by Requiem`);
    }

    if (critical.length > 0) {
      lines.push(``);
      lines.push(`### Required action`);
      lines.push(``);
      lines.push(
        `${critical.length} critical danger${critical.length === 1 ? "" : "s"} detected. ` +
          `Requiem injected ${added.length} safety step${added.length === 1 ? "" : "s"}. ` +
          `Run the migrated workflow and honour all approval gates before touching production.`
      );
    }

    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }

  const filename = `requiem-report-${Date.now()}.md`;
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
