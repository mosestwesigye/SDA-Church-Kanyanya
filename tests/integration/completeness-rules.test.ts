import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { createMember } from "@/server/members/service";
import { setPhotoRequired } from "@/server/settings/completeness";
import { getCompletenessRules } from "@/server/settings/rules";
import { ForbiddenError } from "@/server/errors";
import { testDb, userWith } from "./helpers";

let db: Db;
let admin: Awaited<ReturnType<typeof userWith>>;

beforeAll(async () => {
  db = await testDb();
  admin = await userWith(db, ["SYSTEM_ADMIN"]);
});
afterAll(async () => {
  await setPhotoRequired(db, admin, true); // leave the default for other files
  await db.$disconnect();
});

describe("photo completeness rule", () => {
  it("defaults to counting the photo", async () => {
    expect(await getCompletenessRules(db)).toEqual({ photoRequired: true });
  });

  it("only admins (admin.lists:manage) can change it", async () => {
    const clerk = await userWith(db, ["CHURCH_CLERK"]);
    await expect(setPhotoRequired(db, clerk, false)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rescoring every member and auditing the change", async () => {
    const m = await createMember(db, admin, { lastName: "Rule", firstName: "Photo" });
    expect(m.missingFields).toContain("photo");
    expect(m.completeness).toBe(14);

    const { changed } = await setPhotoRequired(db, admin, false);
    expect(changed).toBeGreaterThan(0);
    const after = await db.member.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.missingFields).not.toContain("photo");
    expect(after.completeness).toBe(15);

    const audit = await db.auditLog.findFirstOrThrow({ where: { entity: "AppSetting", entityId: "completeness.photoRequired" }, orderBy: { id: "desc" } });
    expect(audit).toMatchObject({ actorUserId: admin.userId, action: "UPDATE", oldValue: true, newValue: false });

    // New writes follow the new rule too.
    const fresh = await createMember(db, admin, { lastName: "Rule", firstName: "Later" });
    expect(fresh.missingFields).not.toContain("photo");

    // Turning it back on restores the photo requirement; setting the same value is a no-op.
    await setPhotoRequired(db, admin, true);
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).missingFields).toContain("photo");
    expect(await setPhotoRequired(db, admin, true)).toEqual({ changed: 0 });
  });
});
