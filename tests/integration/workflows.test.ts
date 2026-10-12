import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { uploadDocument } from "@/server/members/documents";
import { addMinistry, createMember, softDeleteMember, updateMember } from "@/server/members/service";
import { advanceTransfer, applyPendingStatusRequest, cancelStatusRequest, createStatusRequest, purgeMember } from "@/server/workflows/status";
import { listId, testDb, userWith } from "./helpers";

let db: Db;
let clerk: Awaited<ReturnType<typeof userWith>>;
let pastor: Awaited<ReturnType<typeof userWith>>;
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  db = await testDb();
  clerk = await userWith(db, ["CHURCH_CLERK"]);
  pastor = await userWith(db, ["PASTOR"]);
});
afterAll(async () => {
  await db.$disconnect();
});

async function activeMember(name: string) {
  const m = await createMember(db, clerk, { lastName: "Wf", firstName: name });
  await updateMember(db, clerk, m.id, { status: "ACTIVE" });
  return m;
}

describe("status changes", () => {
  it("transfer out applies at once: status, history, audit and transfer stage", async () => {
    const m = await activeMember("Out");
    const doc = await uploadDocument(db, clerk, m.id, "TRANSFER_LETTER", { data: Buffer.from("%PDF-1.4"), name: "letter.pdf" });
    const req = await createStatusRequest(db, clerk, { memberId: m.id, type: "TRANSFER_OUT", reason: "Moving to Ntinda for work", effectiveDate: today, otherChurch: "Ntinda SDA", documentId: doc.id });
    expect(req).toMatchObject({ state: "APPROVED", fromStatus: "ACTIVE", toStatus: "SELF_TRANSFERRED", decidedById: clerk.userId });

    const after = await db.member.findUniqueOrThrow({ where: { id: m.id }, include: { events: { where: { type: "TRANSFER_OUT" } }, transfers: true } });
    expect(after.status).toBe("SELF_TRANSFERRED");
    expect(after.events).toHaveLength(1);
    expect(after.events[0]).toMatchObject({ type: "TRANSFER_OUT", title: "Transferred out to Ntinda SDA", createdById: clerk.userId, fromStatus: "ACTIVE", toStatus: "SELF_TRANSFERRED" });
    expect(after.transfers[0]).toMatchObject({ stage: "BOARD_APPROVED", direction: "OUT" });
    const audit = await db.auditLog.findMany({ where: { memberId: m.id, source: "WORKFLOW" }, orderBy: { id: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["CREATE", "UPDATE"]);
    expect(audit.find((a) => a.field === "status" && a.action === "UPDATE")).toMatchObject({ actorUserId: clerk.userId, oldValue: "ACTIVE", newValue: "SELF_TRANSFERRED" });
    // Already that status.
    await expect(createStatusRequest(db, clerk, { memberId: m.id, type: "STATUS_UPDATE", toStatus: "SELF_TRANSFERRED", reason: "same status again", effectiveDate: today })).rejects.toBeInstanceOf(ValidationError);

    // Letter then completion.
    const t = after.transfers[0];
    await expect(advanceTransfer(db, clerk, t.id, "LETTER_RECEIVED")).rejects.toBeInstanceOf(ValidationError);
    await expect(advanceTransfer(db, clerk, t.id, "COMPLETED")).rejects.toThrow(/letter/);
    await advanceTransfer(db, clerk, t.id, "LETTER_SENT");
    await advanceTransfer(db, clerk, t.id, "COMPLETED");
    expect((await db.transfer.findUniqueOrThrow({ where: { id: t.id } })).stage).toBe("COMPLETED");
  });

  it("death, discipline and restoration; discipline history hidden from non-sensitive roles", async () => {
    const m = await activeMember("Disc");
    await addMinistry(db, clerk, m.id, await listId(db, "MINISTRY", "Youth"), await listId(db, "MINISTRY_ROLE", "Member"));
    await createStatusRequest(db, pastor, { memberId: m.id, type: "DISCIPLINE", reason: "Board decision 3/2026", effectiveDate: today });
    await createStatusRequest(db, clerk, { memberId: m.id, type: "RESTORATION", reason: "Restored by the board", effectiveDate: today });
    const events = await db.membershipEvent.findMany({ where: { memberId: m.id, type: { not: "STATUS_CHANGE" } }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.type)).toEqual(["DISCIPLINE", "RESTORATION"]);
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("ACTIVE");

    const dead = await activeMember("Dead");
    await expect(createStatusRequest(db, clerk, { memberId: dead.id, type: "DEATH", reason: "x", effectiveDate: today })).rejects.toThrow();
    await createStatusRequest(db, clerk, { memberId: dead.id, type: "DEATH", reason: "Passed away at Mulago", effectiveDate: today });
    expect((await db.member.findUniqueOrThrow({ where: { id: dead.id } })).status).toBe("DECEASED");
    await expect(createStatusRequest(db, clerk, { memberId: dead.id, type: "DISCIPLINE", reason: "should fail", effectiveDate: today })).rejects.toThrow(/deceased/);
  });

  it("needs status_request:create; elders and treasurers can't change status", async () => {
    const m = await activeMember("Scope");
    for (const role of ["TREASURER", "ELDER"] as const) {
      const u = await userWith(db, [role]);
      await expect(createStatusRequest(db, u, { memberId: m.id, type: "DEATH", reason: "Passed away", effectiveDate: today })).rejects.toBeInstanceOf(ForbiddenError);
    }
    const assistant = await userWith(db, ["ASSISTANT_CLERK"]);
    await createStatusRequest(db, assistant, { memberId: m.id, type: "STATUS_UPDATE", toStatus: "IRREGULAR", reason: "Not attended for a year", effectiveDate: today });
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("IRREGULAR");
  });

  it("the edit form changes status directly and records it in the history", async () => {
    const m = await activeMember("Edit");
    await updateMember(db, clerk, m.id, { status: "IRREGULAR" }, { note: "Rarely attends" });
    const events = await db.membershipEvent.findMany({ where: { memberId: m.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => [e.type, e.fromStatus, e.toStatus])).toEqual([
      ["STATUS_CHANGE", null, "ACTIVE"],
      ["STATUS_CHANGE", "ACTIVE", "IRREGULAR"],
    ]);
    expect(events[1]).toMatchObject({ title: "Status: Active → Irregular", detail: "Rarely attends", createdById: clerk.userId });
  });

  it("unfinished requests from before can be applied or discarded", async () => {
    const m = await activeMember("Legacy");
    const mk = () =>
      db.statusChangeRequest.create({
        data: { memberId: m.id, type: "STATUS_UPDATE", fromStatus: "ACTIVE", toStatus: "IRREGULAR", reason: "Old pending request", effectiveDate: new Date(`${today}T00:00:00Z`), requestedById: pastor.userId },
      });
    const old = await mk();
    // A new change waits until the old request is finished.
    await expect(createStatusRequest(db, clerk, { memberId: m.id, type: "DEATH", reason: "Passed away", effectiveDate: today })).rejects.toBeInstanceOf(ConflictError);
    const other = await userWith(db, ["TREASURER"]);
    await expect(cancelStatusRequest(db, other, old.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(applyPendingStatusRequest(db, other, old.id)).rejects.toBeInstanceOf(ForbiddenError);
    await cancelStatusRequest(db, clerk, old.id);
    expect((await db.statusChangeRequest.findUniqueOrThrow({ where: { id: old.id } })).state).toBe("CANCELLED");
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("ACTIVE");

    const again = await mk();
    await applyPendingStatusRequest(db, clerk, again.id);
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("IRREGULAR");
    expect((await db.statusChangeRequest.findUniqueOrThrow({ where: { id: again.id } })).state).toBe("APPROVED");
    await expect(applyPendingStatusRequest(db, clerk, again.id)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("soft delete and purge", () => {
  it("only admins purge, only after the retention period; PII wiped, ID kept retired", async () => {
    const admin = await userWith(db, ["SYSTEM_ADMIN"]);
    const m = await createMember(db, clerk, { lastName: "Purge", firstName: "Me", phone: "0772 300 300", maritalStatus: "SINGLE", nextOfKinName: "Kin" });
    const doc = await uploadDocument(db, clerk, m.id, "OTHER", { data: Buffer.from("%PDF-1.4"), name: "d.pdf" });
    await expect(purgeMember(db, admin, m.id)).rejects.toThrow(/Only deleted/);
    await softDeleteMember(db, clerk, m.id, "Left long ago");
    await expect(purgeMember(db, clerk, m.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(purgeMember(db, admin, m.id)).rejects.toThrow(/retention/);
    await db.member.update({ where: { id: m.id }, data: { deletedAt: new Date(Date.now() - 400 * 86400_000) } });
    await purgeMember(db, admin, m.id);
    const p = await db.member.findUniqueOrThrow({ where: { id: m.id } });
    expect(p).toMatchObject({ lastName: "Purged record", firstName: "", phoneE164: null, nextOfKinName: null, maritalStatus: null, memberId: m.memberId });
    expect(p.purgedAt).not.toBeNull();
    expect(await db.document.count({ where: { id: doc.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { memberId: m.id, action: "PURGE" } })).toBe(1);
    await expect(db.member.create({ data: { memberNo: m.memberNo, lastName: "Reuse", firstName: "Attempt" } })).rejects.toThrow();
  });
});
