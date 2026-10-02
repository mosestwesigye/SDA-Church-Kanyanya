/**
 * One-time / idempotent setup for a database:
 *   - roles and the default permission matrix
 *   - controlled lists, value mappings, settings
 *   - the first System Admin (from ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME)
 *
 *   pnpm db:bootstrap
 */
import "dotenv/config";
import { SYSTEM_ACTOR } from "@/server/audit/audit";
import { createStaffUser } from "@/server/admin/users";
import { createDbClient } from "@/server/db";
import { ensureReferenceData } from "@/server/setup/reference-data";

async function main() {
  const db = createDbClient();
  try {
    await ensureReferenceData(db, { resetPermissions: process.argv.includes("--reset-permissions") });
    console.log("Reference data ready.");

    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) {
      console.log("ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin user.");
      return;
    }
    if (await db.user.findUnique({ where: { email } })) {
      console.log(`Admin ${email} already exists.`);
      return;
    }
    await createStaffUser(db, SYSTEM_ACTOR, {
      name: process.env.ADMIN_NAME ?? "System Admin",
      email,
      password,
      roles: ["SYSTEM_ADMIN"],
    });
    console.log(`Created System Admin ${email}. Two-factor setup is required at first sign-in.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
