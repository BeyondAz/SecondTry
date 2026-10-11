import { createRequire } from "node:module";
import pg from "pg";

const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd());

export function getPracticeDbConfig() {
  const configuredUrl = process.env.DATABASE_URL;
  if (!configuredUrl) return null;

  let url;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error("DATABASE_URL is invalid.");
  }
  for (const parameter of [
    "sslmode",
    "sslrootcert",
    "sslcert",
    "sslkey",
    "sslpassword",
  ]) {
    url.searchParams.delete(parameter);
  }

  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 5_000,
    query_timeout: 8_000,
    statement_timeout: 7_000,
    application_name: "second-try-practice-migration",
  };
}

export function createPracticePool() {
  const config = getPracticeDbConfig();
  if (!config) return null;
  try {
    return new pg.Pool(config);
  } catch {
    throw new Error("Practice database configuration is invalid.");
  }
}
