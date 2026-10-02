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
  execSync("pnpm exec prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  process.env.DATABASE_URL = url;
}
