import { Pool, type QueryResult, type QueryResultRow } from "pg";

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. This is a backend-only secret — set it in Render env vars (never in frontend code)."
    );
  }

  // Render Postgres requires SSL. rejectUnauthorized:false is the standard
  // setting for managed Postgres providers whose CA isn't in the default chain.
  const ssl =
    connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
      ? false
      : { rejectUnauthorized: false };

  pool = new Pool({ connectionString, ssl, max: 10 });

  pool.on("error", (err) => {
    console.error("[db] idle client error:", err);
  });

  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const p = getPool();
  return p.query<T>(text, params as never);
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
