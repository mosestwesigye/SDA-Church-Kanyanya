import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { createMember, restoreMember, softDeleteMember, updateMember, addMinistry } from "@/server/members/service";
import { AuditWriter, SYSTEM_ACTOR } from "@/server/audit/audit";
import { ConflictError, ValidationError } from "@/server/errors";
import { listId, rawMember, testDb, userWith } from "./helpers";

let db: Db;
let clerk: Awaited<ReturnType<typeof userWith>>;

beforeAll(async () => {
  db = await testDb();
  clerk = await userWith(db, ["CHURCH_CLERK"]);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("audit log is append-only", () => {
  it("rejects UPDATE, DELETE and TRUNCATE at the database level", async () => {
    await new AuditWriter(db, SYSTEM_ACTOR, "SYSTEM").log({ action: "SECURITY", entity: "Test", note: "probe" });
    const row = await db.auditLog.findFirstOrThrow({ where: { entity: "Test" } });
    await expect(db.auditLog.update({ where: { id: row.id }, data: { note: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(db.$executeRawUnsafe('TRUNCATE "AuditLog"')).rejects.toThrow(/append-only/);
    expect((await db.auditLog.findUniqueOrThrow({ where: { id: row.id } })).note).toBe("probe");
  });
});

describe("audited member writes", () => {
  it("records one row per changed field with actor, source, session and IP", async () => {
    const m = await createMember(db, clerk, { lastName: "Namubiru", firstName: "Esther" });
    const zone = await listId(db, "ZONE", "Kiteezi");
    const { changes } = await updateMember(db, clerk, m.id, { phone: "0752 66 4091", zoneId: zone }, { expectedVersion: 1 }).catch((e) => {
      expect(e).toBeInstanceOf(ValidationError); // invalid phone length
      return updateMember(db, clerk, m.id, { phone: "0752 664 091", zoneId: zone }, { expectedVersion: 1 });
    });
    expect(changes.map((c) => c.field).sort()).toEqual(["phoneE164", "phoneRaw", "zoneId"]);

    const rows = await db.auditLog.findMany({ where: { memberId: m.id, action: "UPDATE" }, orderBy: { id: "asc" } });
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r).toMatchObject({ actorUserId: clerk.userId, actorLabel: clerk.label, source: "UI", sessionId: clerk.sessionId, ipAddress: "127.0.0.1", entity: "Member", entityId: m.id });
    }
    expect(new Set(rows.map((r) => r.correlationId)).size).toBe(1);
    const phone = rows.find((r) => r.field === "phoneE164")!;
    expect(phone.oldValue).toBeNull();
    expect(phone.newValue).toBe("+256752664091");

    const created = await db.auditLog.findFirstOrThrow({ where: { memberId: m.id, action: "CREATE" } });
    expect(created.newValue).toMatchObject({ memberId: m.memberId });
  });

  it("writes nothing when nothing changed", async () => {
    const m = await createMember(db, clerk, { lastName: "Okello", firstName: "David" });
    const before = await db.auditLog.count({ where: { memberId: m.id } });
    const { changes } = await updateMember(db, clerk, m.id, { lastName: "Okello" });
    expect(changes).toEqual([]);
    expect(await db.auditLog.count({ where: { memberId: m.id } })).toBe(before);
  });

  it("rolls back the audit rows when the write fails (stale version)", async () => {
    const m = await createMember(db, clerk, { lastName: "Achieng", firstName: "Ruth" });
    const before = await db.auditLog.count({ where: { memberId: m.id } });
    await expect(updateMember(db, clerk, m.id, { firstName: "Rut" }, { expectedVersion: 99 })).rejects.toBeInstanceOf(ConflictError);
    expect(await db.auditLog.count({ where: { memberId: m.id } })).toBe(before);
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).firstName).toBe("Ruth");
  });

  it("keeps completeness in step with every write", async () => {
    const m = await createMember(db, clerk, { lastName: "Mugisha", firstName: "Brian" });
    expect(m.completeness).toBe(14);
    await addMinistry(db, clerk, m.id, await listId(db, "MINISTRY", "Youth"), await listId(db, "MINISTRY_ROLE", "Member"));
    const after = await db.member.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.completeness).toBe(21);
    expect(after.missingFields).not.toContain("ministry");
    expect(await db.auditLog.count({ where: { memberId: m.id, entity: "MemberMinistry" } })).toBe(1);
  });

  it("routes status changes through approval once a status is set", async () => {
    const m = await createMember(db, clerk, { lastName: "Kato", firstName: "Emmanuel" });
    await updateMember(db, clerk, m.id, { status: "ACTIVE" }); // first status: allowed
    await expect(updateMember(db, clerk, m.id, { status: "DECEASED" })).rejects.toThrow(/approval/);
  });

  it("logs soft delete and restore, and blocks edits while deleted", async () => {
    const m = await createMember(db, clerk, { lastName: "Lubega", firstName: "Samuel" });
    await softDeleteMember(db, clerk, m.id, "Entered twice");
    await expect(updateMember(db, clerk, m.id, { firstName: "Sam" })).rejects.toThrow(/Restore/);
    await restoreMember(db, clerk, m.id);
    const actions = (await db.auditLog.findMany({ where: { memberId: m.id }, orderBy: { id: "asc" } })).map((r) => r.action);
    expect(actions).toEqual(["CREATE", "DELETE", "RESTORE"]);
    const del = await db.auditLog.findFirstOrThrow({ where: { memberId: m.id, action: "DELETE" } });
    expect(del.note).toBe("Entered twice");
  });
});

describe("member IDs are permanent and never reused", () => {
  it("issues SDAK/M#### from the sequence", async () => {
    const a = await rawMember(db);
    const b = await rawMember(db);
    expect(a.memberId).toBe(`SDAK/M${String(a.memberNo).padStart(4, "0")}`);
    expect(b.memberNo).toBe(a.memberNo + 1);
  });

  it("cannot be changed", async () => {
    const a = await rawMember(db);
    await expect(db.member.update({ where: { id: a.id }, data: { memberId: "SDAK/M9999" } })).rejects.toThrow(/permanent/);
    await expect(db.member.update({ where: { id: a.id }, data: { memberNo: 99999 } })).rejects.toThrow(/permanent/);
  });

  it("members cannot be hard-deleted", async () => {
    const a = await rawMember(db);
    await expect(db.member.delete({ where: { id: a.id } })).rejects.toThrow(/cannot be deleted/);
  });

  it("explicitly imported numbers push the sequence forward", async () => {
    const max = (await db.member.aggregate({ _max: { memberNo: true } }))._max.memberNo ?? 0;
    const target = max + 100;
    const high = await rawMember(db, { memberNo: target });
    expect(high.memberId).toBe(`SDAK/M${String(target).padStart(4, "0")}`);
    const next = await rawMember(db);
    expect(next.memberNo).toBe(target + 1);
  });

  it("a soft-deleted member keeps their number", async () => {
    const a = await createMember(db, clerk, { lastName: "Nalwoga", firstName: "Florence" });
    await softDeleteMember(db, clerk, a.id, "test");
    const b = await rawMember(db);
    expect(b.memberNo).toBeGreaterThan(a.memberNo);
    await expect(rawMember(db, { memberNo: a.memberNo })).rejects.toThrow();
  });
});
