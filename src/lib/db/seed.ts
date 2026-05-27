import { config as loadEnv } from "dotenv";
import { closePool } from "./client";
import { appendAudit, insertScript } from "./queries";
import type { BashScript } from "../types";

loadEnv();

const REPO = "https://github.com/example/legacy-ops";

const seedScripts: BashScript[] = [
  {
    id: "seed-deploy",
    repoUrl: REPO,
    path: "scripts/deploy.sh",
    filename: "deploy.sh",
    createdAt: new Date().toISOString(),
    content: `#!/bin/bash
# the deploy script that lies on failure
set -e

cd /opt/app
git pull origin main
npm install --production
npm run build

pm2 restart app

curl -X POST $SLACK_WEBHOOK \\
  -H 'Content-Type: application/json' \\
  -d '{"text":"Deploy succeeded :rocket:"}'

echo "done"
`,
  },
  {
    id: "seed-db-migrate",
    repoUrl: REPO,
    path: "scripts/db_migrate.sh",
    filename: "db_migrate.sh",
    createdAt: new Date().toISOString(),
    content: `#!/bin/bash
# applies pending schema changes against prod. no backup. no confirm.
set -e

psql $DATABASE_URL <<'SQL'
ALTER TABLE users DROP COLUMN legacy_token;
ALTER TABLE users ADD COLUMN session_token TEXT NOT NULL DEFAULT '';
DROP TABLE IF EXISTS old_sessions;
SQL

echo "migration complete"
`,
  },
  {
    id: "seed-runbook",
    repoUrl: REPO,
    path: "runbooks/restart_workers.sh",
    filename: "restart_workers.sh",
    createdAt: new Date().toISOString(),
    content: `#!/bin/bash
# 2am incident runbook: restart stuck workers and page oncall.
sudo systemctl restart workers
sleep 5
redis-cli FLUSHDB
curl http://localhost:8080/health
pagerduty-cli trigger --service workers --message "restarted"
`,
  },
  {
    id: "seed-cleanup",
    repoUrl: REPO,
    path: "cron/cleanup.sh",
    filename: "cleanup.sh",
    createdAt: new Date().toISOString(),
    content: `#!/bin/bash
# nightly cron. rm -rf with env var paths. what could go wrong.
TMP_DIR=$TMP_DIR
CACHE_DIR=$CACHE_DIR

rm -rf $TMP_DIR/*
rm -rf $CACHE_DIR/*
rm -rf /var/log/app/*.log
find / -name "*.tmp" -delete --force 2>/dev/null
echo "cleanup done"
`,
  },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "[seed] DATABASE_URL is not set. Set it in .env or the shell before running."
    );
    process.exit(1);
  }

  console.log(`[seed] inserting ${seedScripts.length} scripts ...`);
  for (const s of seedScripts) {
    await insertScript(s);
    console.log(`[seed]   ${s.filename}`);
  }

  await appendAudit({
    timestamp: new Date().toISOString(),
    actor: "seed",
    action: "insert_scripts",
    detail: `seeded ${seedScripts.length} scripts`,
  });

  console.log("[seed] done.");
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
