import "server-only";
import { Pool, type QueryResultRow } from "pg";
import { env } from "./env";

/** "app" is the private workspace; "demo" holds synthetic data and is only ever read. */
export type Space = "app" | "demo";

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    const url = env.databaseUrl();
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    pool = new Pool({
      connectionString: url,
      ssl: local ? false : { rejectUnauthorized: true },
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
    });
    pool.on("error", () => {
      // Idle client errors (e.g. serverless DB suspending) are recovered on next checkout.
    });
  }
  return pool;
}

export async function q<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  return getPool().query<T>(text, params);
}

/** Schema name for a space. Only these two literals ever reach SQL text. */
export function sch(space: Space): "app" | "demo" {
  return space === "demo" ? "demo" : "app";
}

export async function tx<T>(fn: (query: typeof q) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const run = (async (text: string, params: unknown[] = []) => client.query(text, params)) as typeof q;
    const out = await fn(run);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
