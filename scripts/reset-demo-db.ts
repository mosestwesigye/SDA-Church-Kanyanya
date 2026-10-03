/**
 * One-time switch from the demo to real data on a deployed database.
 *
 * Runs only when RESET_DEMO_DATABASE=yes, and only wipes the database if it
 * holds nothing but the fictitious demo: no import other than the demo seed,
 * and no logins other than the demo accounts (@example.org) or member
 * self-service logins created against demo members. Otherwise it refuses and
 * leaves the data untouched.
 *
 * The audit log and member ID triggers block row deletion by design, so the
 * reset drops and recreates the schema; `prisma migrate deploy` then rebuilds it.
 */
import "dotenv/config";
import pg from "pg";

async function main() {
  if (process.env.RESET_DEMO_DATABASE !== "yes") return;
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const exists = (await client.query(`select to_regclass('public."Member"') as t`)).rows[0].t;
    if (!exists) {
      console.log("reset-demo-db: database is empty — nothing to reset.");
      return;
    }
    const realImports = Number((await client.query(`select count(*)::int as n from "ImportBatch" where "fileHash" <> 'demo-seed-v1'`)).rows[0].n);
    const realUsers = Number(
      (await client.query(`select count(*)::int as n from "User" where email not like '%@example.org' and email not like '%@members.sdak.invalid'`)).rows[0].n,
    );
    if (realImports > 0 || realUsers > 0) {
      console.warn(`reset-demo-db: REFUSED — found ${realImports} non-demo import(s) and ${realUsers} non-demo login(s). Real data is never wiped. Remove RESET_DEMO_DATABASE.`);
      return;
    }
    await client.query("drop schema public cascade");
    await client.query("create schema public");
    console.log("reset-demo-db: demo database wiped; migrations will recreate the schema.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
