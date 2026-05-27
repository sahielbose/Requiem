import { NextResponse } from "next/server";
import { scanRepoForScripts } from "@/lib/github/scanner";
import { enqueueScanJob } from "@/worker/jobs";
import { query } from "@/lib/db/client";
import type { BashScript } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SeedRow {
  id: string;
  repo_url: string;
  path: string;
  filename: string;
  content: string;
  created_at: Date;
}

async function loadSeedScripts(): Promise<BashScript[]> {
  try {
    const res = await query<SeedRow>(
      `SELECT id, repo_url, path, filename, content, created_at
         FROM scripts
        ORDER BY created_at DESC
        LIMIT 100`
    );
    return res.rows.map((r) => ({
      id: r.id,
      repoUrl: r.repo_url,
      path: r.path,
      filename: r.filename,
      content: r.content,
      createdAt: r.created_at.toISOString(),
    }));
  } catch (err) {
    console.warn(
      "[api/scan] seed fallback failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

export async function POST(req: Request) {
  let body: { repoUrl?: string };
  try {
    body = (await req.json()) as { repoUrl?: string };
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body" },
      { status: 400 }
    );
  }

  const repoUrl = body.repoUrl?.trim();
  if (!repoUrl) {
    return NextResponse.json(
      { error: "repoUrl is required" },
      { status: 400 }
    );
  }

  let scripts = await scanRepoForScripts(repoUrl);
  let fellBackToSeed = false;

  if (scripts.length === 0) {
    fellBackToSeed = true;
    scripts = await loadSeedScripts();
  }

  if (scripts.length === 0) {
    return NextResponse.json(
      {
        error:
          "no scripts found in repo and no seed fallback available — run `npm run db:seed` first",
      },
      { status: 404 }
    );
  }

  const job = enqueueScanJob(repoUrl, scripts);
  return NextResponse.json({
    jobId: job.id,
    scriptCount: scripts.length,
    fellBackToSeed,
  });
}
