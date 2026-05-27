import { NextResponse } from "next/server";
import { getExecutions } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const records = await getExecutions();
    return NextResponse.json(records);
  } catch (err) {
    console.error(
      "[api/executions] failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 }
    );
  }
}
