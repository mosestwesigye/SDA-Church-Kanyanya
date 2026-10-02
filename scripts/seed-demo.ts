/**
 * Fictitious demo data for local development, demos and staging — never real
 * people. Refuses to run on a database that already has members.
 *
 *   pnpm db:seed:demo
 *
 * Creates ~1,050 members (≈20% complete, ≈27% partial, rest name + ID only),
 * planted duplicates and non-standard values for the clean-up queues, and one
 * login per role (password: DEMO_PASSWORD, default "Demo-pass-2026").
 */
import "dotenv/config";
import { SYSTEM_ACTOR } from "@/server/audit/audit";
import { createStaffUser } from "@/server/admin/users";
import { createDbClient } from "@/server/db";
import { generateDemoMembers } from "@/server/setup/demo-data";
import { ensureReferenceData } from "@/server/setup/reference-data";
import { refreshCompleteness } from "@/server/members/service";
import { commitImport, loadLookups, type PreparedImport } from "@/server/import/register-import";
import type { RoleKey } from "@/server/authz/catalog";

async function main() {
  const db = createDbClient();
  try {
    if ((await db.member.count()) > 0 && !process.argv.includes("--allow-nonempty")) {
      throw new Error("Database already has members. The demo seed only runs on an empty database.");
    }
    await ensureReferenceData(db);
    const lookups = await loadLookups(db);
    const rows = generateDemoMembers(lookups, { count: 1050, seed: 20261002 });
    const prepared: PreparedImport = {
      fileName: "demo-seed",
      fileHash: "demo-seed-v1",
      sheetName: "demo",
      headerRow: 0,
      columnMap: {},
      headers: {},
      agesAsOf: new Date().toISOString().slice(0, 10),
      rows,
      summary: { rows: rows.length, errors: 0, warnings: 0, withIssues: 0, skipped: 0 },
    };
    const batch = await commitImport(db, { ...SYSTEM_ACTOR, label: "Demo seed" }, prepared);
    console.log("Members:", batch.totals);

    // Give the fully-filled tier a placeholder photo so those records reach 100%.
    const nearlyComplete = await db.member.findMany({ where: { completeness: { gte: 90 } }, select: { id: true } });
    for (const { id } of nearlyComplete) {
      await db.member.update({ where: { id }, data: { photoKey: "demo/placeholder-photo.png" } });
      await refreshCompleteness(db, id);
    }

    const password = process.env.DEMO_PASSWORD ?? "Demo-pass-2026";
    const youth = await db.listItem.findFirstOrThrow({ where: { type: "MINISTRY", label: "Youth" } });
    const self = await db.member.findFirstOrThrow({ where: { completeness: { gte: 80 } }, orderBy: { memberNo: "asc" } });
    const users: { email: string; name: string; roles: RoleKey[]; ministryIds?: string[]; memberId?: string }[] = [
      { email: "admin@example.org", name: "Demo Admin", roles: ["SYSTEM_ADMIN"] },
      { email: "clerk@example.org", name: "Grace Nakato", roles: ["CHURCH_CLERK"] },
      { email: "asst.clerk@example.org", name: "Sarah Nabukenya", roles: ["ASSISTANT_CLERK"] },
      { email: "pastor@example.org", name: "Pr. Ochieng", roles: ["PASTOR"] },
      { email: "elder@example.org", name: "Elder Ssemwanga", roles: ["ELDER"] },
      { email: "youth.head@example.org", name: "Brian Mugisha", roles: ["MINISTRY_HEAD"], ministryIds: [youth.id] },
      { email: "treasurer@example.org", name: "Demo Treasurer", roles: ["TREASURER"] },
      { email: "member@example.org", name: `${self.firstName} ${self.lastName}`, roles: ["MEMBER"], memberId: self.id },
    ];
    for (const u of users) {
      if (await db.user.findUnique({ where: { email: u.email } })) continue;
      await createStaffUser(db, SYSTEM_ACTOR, { ...u, password });
    }
    console.log(`Demo logins (password "${password}"):`, users.map((u) => u.email).join(", "));
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
