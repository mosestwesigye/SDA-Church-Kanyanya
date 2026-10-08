import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { addListItem, listItemsForAdmin, renameListItem, setListItemActive } from "@/server/admin/lists";
import { permissionMatrix, setPermission } from "@/server/admin/roles";
import { adminCreateUser, listUsers, resetUserTwoFactor, revokeSessions, setUserActive, updateUserAccess } from "@/server/admin/users";
import { parseAuditQuery, searchAudit } from "@/server/audit/query";
import { loadAuthContext } from "@/server/authz/context";
import { can } from "@/server/authz/policy";
import { createMember, updateMember } from "@/server/members/service";
import { testDb, userWith } from "./helpers";

let db: Db;
let admin: Awaited<ReturnType<typeof userWith>>;
let clerk: Awaited<ReturnType<typeof userWith>>;

beforeAll(async () => {
  db = await testDb();
  admin = await userWith(db, ["SYSTEM_ADMIN"]);
  clerk = await userWith(db, ["CHURCH_CLERK"]);
});
afterAll(async () => {
  await db.$disconnect();
});

const session = (userId: string) => db.session.create({ data: { userId, token: `t-${Math.random()}`, expiresAt: new Date(Date.now() + 3600_000) } });
const lastAudit = (where: object) => db.auditLog.findFirst({ where, orderBy: { id: "desc" } });

describe("admin permissions", () => {
  it("only admins reach user, role, list and security administration", async () => {
    for (const fn of [
      () => listUsers(db, clerk),
      () => permissionMatrix(db, clerk),
      () => adminCreateUser(db, clerk, { name: "X Y", email: "x@example.org", password: "Long-enough-pass1", roles: ["ELDER"] }),
      () => setPermission(db, clerk, { roleId: "x", resource: "report", action: "read", scope: "ALL" }),
      () => resetUserTwoFactor(db, clerk, clerk.userId),
      () => revokeSessions(db, clerk, { userId: admin.userId }),
    ]) {
      await expect(fn()).rejects.toBeInstanceOf(ForbiddenError);
    }
    // Clerks manage nothing under admin.lists by default either.
    await expect(addListItem(db, clerk, "ZONE", "Nowhere")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the global audit trail needs church-wide audit access", async () => {
    const elder = await userWith(db, ["ELDER"]);
    await expect(searchAudit(db, elder, parseAuditQuery({}))).rejects.toBeInstanceOf(ForbiddenError);
    const head = await userWith(db, ["MINISTRY_HEAD"], { ministryLabels: ["Youth"] });
    await expect(searchAudit(db, head, parseAuditQuery({}))).rejects.toBeInstanceOf(ForbiddenError);
    const res = await searchAudit(db, clerk, parseAuditQuery({ action: "CREATE", entity: "User" }));
    expect(res.rows.every((r) => r.action === "CREATE" && r.entity === "User")).toBe(true);
  });
});

describe("users", () => {
  it("creates staff users (audited) and refuses member logins or duplicate emails", async () => {
    const email = `new-${Date.now()}@example.org`;
    const u = await adminCreateUser(db, admin, { name: "New Elder", email, password: "Long-enough-pass1", roles: ["ELDER"] });
    expect(await lastAudit({ entity: "User", entityId: u.id, action: "CREATE", actorUserId: admin.userId })).not.toBeNull();
    await expect(adminCreateUser(db, admin, { name: "Again", email, password: "Long-enough-pass1", roles: ["ELDER"] })).rejects.toBeInstanceOf(ValidationError);
    await expect(adminCreateUser(db, admin, { name: "Member", email: `m-${email}`, password: "Long-enough-pass1", roles: ["MEMBER"] })).rejects.toBeInstanceOf(ValidationError);
    await expect(adminCreateUser(db, admin, { name: "Head", email: `h-${email}`, password: "Long-enough-pass1", roles: ["MINISTRY_HEAD"] })).rejects.toBeInstanceOf(ValidationError);
  });

  it("changes access with audit, signs the user out and applies the new grants", async () => {
    const u = await userWith(db, ["ELDER"]);
    await session(u.userId);
    expect(can(u, "member.sensitive", "update")).toBe(false);
    await updateUserAccess(db, admin, u.userId, { roles: ["ASSISTANT_CLERK"], ministryIds: [] });
    expect(await db.session.count({ where: { userId: u.userId } })).toBe(0);
    const after = await loadAuthContext(db, u.userId);
    expect(after.roles).toEqual(["ASSISTANT_CLERK"]);
    expect(can(after, "member.sensitive", "update")).toBe(true);
    const a = await lastAudit({ entity: "User", entityId: u.userId, field: "access" });
    expect(a).toMatchObject({ oldValue: { roles: ["ELDER"] }, newValue: { roles: ["ASSISTANT_CLERK"] } });
  });

  it("deactivation signs out everywhere; self-deactivation and losing the last admin are refused", async () => {
    const u = await userWith(db, ["TREASURER"]);
    await session(u.userId);
    await setUserActive(db, admin, u.userId, false);
    expect(await db.session.count({ where: { userId: u.userId } })).toBe(0);
    expect((await loadAuthContext(db, u.userId)).active).toBe(false);
    expect(await lastAudit({ entity: "User", entityId: u.userId, field: "active" })).toMatchObject({ action: "SECURITY", newValue: false });
    await expect(setUserActive(db, admin, admin.userId, false)).rejects.toBeInstanceOf(ValidationError);

    // Make `admin` the only active System Admin, then try to take the role away.
    const others = await db.user.findMany({ where: { active: true, id: { not: admin.userId }, roles: { some: { role: { key: "SYSTEM_ADMIN" } } } }, select: { id: true } });
    await db.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { active: false } });
    try {
      const other = await userWith(db, ["SYSTEM_ADMIN"]);
      await db.user.update({ where: { id: other.userId }, data: { active: false } });
      await expect(updateUserAccess(db, other, admin.userId, { roles: ["CHURCH_CLERK"], ministryIds: [] })).rejects.toBeInstanceOf(ValidationError);
    } finally {
      await db.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { active: true } });
    }
  });

  it("resets two-step verification (audited)", async () => {
    const u = await userWith(db, ["PASTOR"]);
    await db.user.update({ where: { id: u.userId }, data: { twoFactorEnabled: true } });
    await db.twoFactor.create({ data: { userId: u.userId, secret: "s", backupCodes: "b" } });
    await resetUserTwoFactor(db, admin, u.userId);
    expect(await db.twoFactor.count({ where: { userId: u.userId } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.userId } })).twoFactorEnabled).toBe(false);
    expect(await lastAudit({ entity: "User", entityId: u.userId, action: "SECURITY" })).not.toBeNull();
  });
});

describe("permission matrix", () => {
  it("grants and revokes with audit; changes take effect on the next context load", async () => {
    const role = await db.role.findUniqueOrThrow({ where: { key: "TREASURER" } });
    const t = await userWith(db, ["TREASURER"]);
    expect(can(t, "report", "read")).toBe(false);
    await setPermission(db, admin, { roleId: role.id, resource: "report", action: "read", scope: "ALL" });
    expect(can(await loadAuthContext(db, t.userId), "report", "read")).toBe(true);
    expect(await lastAudit({ entity: "Permission", entityId: "TREASURER:report:read" })).toMatchObject({ oldValue: "none", newValue: "ALL" });
    await setPermission(db, admin, { roleId: role.id, resource: "report", action: "read", scope: null });
    expect(can(await loadAuthContext(db, t.userId), "report", "read")).toBe(false);
    await expect(setPermission(db, admin, { roleId: role.id, resource: "report", action: "fly", scope: "ALL" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to lock System Admin out of administration", async () => {
    const role = await db.role.findUniqueOrThrow({ where: { key: "SYSTEM_ADMIN" } });
    await expect(setPermission(db, admin, { roleId: role.id, resource: "admin.roles", action: "manage", scope: null })).rejects.toBeInstanceOf(ValidationError);
  });

  it("only System Administrators need two-step verification", async () => {
    expect((await loadAuthContext(db, admin.userId)).requires2fa).toBe(true);
    for (const role of ["CHURCH_CLERK", "PASTOR", "ELDER", "TREASURER"] as const) {
      expect((await loadAuthContext(db, (await userWith(db, [role])).userId)).requires2fa).toBe(false);
    }
    expect((await loadAuthContext(db, (await userWith(db, ["CHURCH_CLERK", "SYSTEM_ADMIN"])).userId)).requires2fa).toBe(true);
  });
});

describe("controlled lists", () => {
  it("adds, renames and hides items with audit; refuses duplicates", async () => {
    const name = `Zone ${Date.now().toString(36)}`;
    const z = await addListItem(db, admin, "ZONE", name);
    await expect(addListItem(db, admin, "ZONE", name.toUpperCase())).rejects.toBeInstanceOf(ValidationError);
    const m = await createMember(db, clerk, { lastName: "List", firstName: "Zoned" });
    await updateMember(db, clerk, m.id, { zoneId: z.id });
    await renameListItem(db, admin, z.id, `${name} East`);
    await setListItemActive(db, admin, z.id, false);
    const items = await listItemsForAdmin(db, admin, "ZONE");
    expect(items.find((i) => i.id === z.id)).toMatchObject({ label: `${name} East`, active: false, used: 1 });
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).zoneId).toBe(z.id);
    expect(await db.auditLog.count({ where: { entity: "ListItem", entityId: z.id } })).toBe(3);
  });
});

describe("audit trail masking", () => {
  it("hides sensitive values from viewers without sensitive access", async () => {
    const m = await createMember(db, clerk, { lastName: "Mask", firstName: "Me" });
    await updateMember(db, clerk, m.id, { nextOfKinName: "Secret Kin" });
    // A role with church-wide audit access but no sensitive-field access.
    const role = await db.role.upsert({ where: { key: "AUDITOR_TEST" }, create: { key: "AUDITOR_TEST", name: "Auditor", isSystem: false }, update: {} });
    for (const resource of ["audit", "member"]) {
      await db.permission.upsert({
        where: { roleId_resource_action: { roleId: role.id, resource, action: "read" } },
        create: { roleId: role.id, resource, action: "read", scope: "ALL" },
        update: {},
      });
    }
    const u = await userWith(db, ["TREASURER"]);
    await db.userRole.deleteMany({ where: { userId: u.userId } });
    await db.userRole.create({ data: { userId: u.userId, roleId: role.id } });
    const auditor = await loadAuthContext(db, u.userId);

    const seen = await searchAudit(db, auditor, parseAuditQuery({ member: m.memberId }));
    const kin = seen.rows.find((r) => r.field === "nextOfKinName")!;
    expect(kin.newValue).toBe("•••");
    const clerkView = await searchAudit(db, clerk, parseAuditQuery({ member: m.memberId }));
    expect(clerkView.rows.find((r) => r.field === "nextOfKinName")!.newValue).toBe("Secret Kin");
  });
});
