import { NextResponse } from "next/server";
import { getMigrationsWithDangers } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getMigrationsWithDangers();
    return NextResponse.json(data);
  } catch (err) {
    console.error(
      "[api/migrations] failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 }
    );
  }
}
