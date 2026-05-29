import { NextResponse } from "next/server";
import { getAuditLog } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(500, parseInt(url.searchParams.get("limit") ?? "200", 10));
  try {
    const entries = await getAuditLog(limit);
    return NextResponse.json(entries);
  } catch (err) {
    console.error("[api/audit]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 }
    );
  }
}
