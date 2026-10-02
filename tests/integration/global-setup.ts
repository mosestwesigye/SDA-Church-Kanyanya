import { execSync } from "node:child_process";
import { Client } from "pg";

/**
 * Integration tests run against a real Postgres database (TEST_DATABASE_URL,
 * default: local sdak_test). The schema is dropped and re-migrated once per
 * run so triggers and sequences are exactly what production gets.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://sdak:sdak@localhost:5432/sdak_test";
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error(`Refusing to reset a database whose name does not contain "test": ${url}`);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SEQUENCE IF EXISTS member_no_seq;");
  await client.end();
  const env = { ...process.env, DATABASE_URL: url };
  execSync("pnpm exec prisma migrate deploy", { env, stdio: "pipe" });
  // Guard: the migrated database must match schema.prisma exactly. Prisma's
  // diff once tried to drop member_no_seq; drift like that must fail CI.
  const drift = execSync("pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script", { env, encoding: "utf8" });
  if (!/empty migration/.test(drift)) throw new Error(`Schema drift between migrations and schema.prisma:\n${drift}`);
  process.env.DATABASE_URL = url;
}
