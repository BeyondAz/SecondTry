import "server-only";

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

const sslParameters = [
  "sslmode",
  "sslrootcert",
  "sslcert",
  "sslkey",
  "sslpassword",
];

let pool: Pool | undefined;

export class PracticeDatabaseUnavailableError extends Error {
  constructor() {
    super("Practice history is temporarily unavailable.");
    this.name = "PracticeDatabaseUnavailableError";
  }
}

export function isPracticeDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function getConnectionString() {
  const configuredUrl = process.env.DATABASE_URL;
  if (!configuredUrl) throw new PracticeDatabaseUnavailableError();

  try {
    const url = new URL(configuredUrl);
    for (const parameter of sslParameters) {
      url.searchParams.delete(parameter);
    }
    return url.toString();
  } catch {
    throw new PracticeDatabaseUnavailableError();
  }
}

export function getPracticePool() {
  if (!pool) {
    const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
    pool = new Pool({
      connectionString: getConnectionString(),
      ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
      max: 4,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      query_timeout: 8_000,
      statement_timeout: 7_000,
      application_name: "second-try-practice",
    });
    pool.on("error", () => {
      console.error("Practice database connection failed; details withheld.");
    });
  }
  return pool;
}

export async function withPracticeTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPracticePool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      console.error("Practice database transaction rollback failed; details withheld.");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function practiceQuery<
  ResultRow extends QueryResultRow = QueryResultRow,
>(
  text: string,
  values: readonly unknown[] = [],
): Promise<QueryResult<ResultRow>> {
  return getPracticePool().query<ResultRow>(text, [...values]);
}
