import { NextResponse } from "next/server";
import { getIncidents, getMigrationsWithDangers, getScript } from "@/lib/db/queries";
import { runIncidentAgent } from "@/agents/incident-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const incidents = await getIncidents();
    return NextResponse.json(incidents);
  } catch (err) {
    console.error(
      "[api/incidents] failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  let body: { scriptId?: string };
  try {
    body = (await req.json()) as { scriptId?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const scriptId = body.scriptId?.trim();
  if (!scriptId) {
    return NextResponse.json({ error: "scriptId is required" }, { status: 400 });
  }

  let script;
  try {
    script = await getScript(scriptId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "db error" },
      { status: 500 }
    );
  }

  if (!script) {
    return NextResponse.json({ error: "script not found" }, { status: 404 });
  }

  let ledger;
  try {
    ledger = await getMigrationsWithDangers();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "db error" },
      { status: 500 }
    );
  }

  const entry = ledger.find((e) => e.script.id === scriptId);
  if (!entry) {
    return NextResponse.json(
      { error: "no migration found for script" },
      { status: 404 }
    );
  }

  const criticalFlags = entry.dangers.filter((f) => f.severity === "critical");
  const alertSummary =
    criticalFlags.length > 0
      ? `${criticalFlags.length} critical danger${criticalFlags.length === 1 ? "" : "s"} in ${script.filename}: ${criticalFlags[0].pattern}`
      : `Manual incident created for ${script.filename}`;

  try {
    const incident = await runIncidentAgent(
      script,
      entry.migration,
      entry.dangers,
      "Manual Trigger",
      alertSummary,
      scriptId
    );
    return NextResponse.json(incident);
  } catch (err) {
    console.error(
      "[api/incidents] incident agent failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 }
    );
  }
}
