import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { query, closePool } from "./client";

loadEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "[migrate] DATABASE_URL is not set. Set it in .env or the shell before running."
    );
    process.exit(1);
  }

  const schemaPath = join(__dirname, "schema.sql");
  const sql = readFileSync(schemaPath, "utf8");

  console.log("[migrate] applying schema.sql ...");
  await query(sql);
  console.log("[migrate] done — schema applied.");
}

main()
  .catch((err) => {
    console.error("[migrate] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
