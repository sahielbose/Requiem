import { config as loadEnv } from "dotenv";

// Worker entrypoint. Two modes:
//
// 1. In-process (default for dev / single-service deploys): API routes call
//    enqueueScanJob() from "./jobs" directly. The job queue lives in the same
//    Node process as the Next.js server. No separate worker needed.
//
// 2. Render Background Worker: this file is the long-running entrypoint
//    (`node dist/worker/index.js` or `tsx src/worker/index.ts`). On its own
//    the in-memory queue here cannot see jobs enqueued by a separate API
//    process — for that, a shared queue (Postgres LISTEN/NOTIFY, Redis, etc.)
//    has to be wired in. The hooks below are where that wiring lands.

loadEnv();

import { listJobs } from "./jobs";

const HEARTBEAT_MS = 60_000;

console.log("[worker] background worker started.");
console.log(
  "[worker] in-process job queue ready. " +
    "To dispatch from a separate process, wire a shared queue here."
);

// Heartbeat so Render keeps the process alive and we can see the worker is healthy.
setInterval(() => {
  const all = listJobs();
  const running = all.filter((j) => j.status === "running").length;
  const queued = all.filter((j) => j.status === "queued").length;
  console.log(
    `[worker] heartbeat — total=${all.length} running=${running} queued=${queued}`
  );
}, HEARTBEAT_MS);

// Graceful shutdown
const shutdown = (sig: string) => {
  console.log(`[worker] received ${sig}, shutting down.`);
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
