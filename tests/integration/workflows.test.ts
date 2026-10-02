import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { uploadDocument } from "@/server/members/documents";
import { addMinistry, createMember, softDeleteMember, updateMember } from "@/server/members/service";
import { advanceTransfer, cancelStatusRequest, createStatusRequest, decideStatusRequest, purgeMember } from "@/server/workflows/status";
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

describe("status change requests", () => {
  it("transfer out: request → approval by pastor → status, history and transfer stage", async () => {
    const m = await activeMember("Out");
    const doc = await uploadDocument(db, clerk, m.id, "TRANSFER_LETTER", { data: Buffer.from("%PDF-1.4"), name: "letter.pdf" });
    const req = await createStatusRequest(db, clerk, { memberId: m.id, type: "TRANSFER_OUT", reason: "Moving to Ntinda for work", effectiveDate: today, otherChurch: "Ntinda SDA", documentId: doc.id });
    expect(req).toMatchObject({ state: "PENDING", fromStatus: "ACTIVE", toStatus: "SELF_TRANSFERRED" });
    // Status unchanged until approved.
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("ACTIVE");
    // One pending request at a time.
    await expect(createStatusRequest(db, clerk, { memberId: m.id, type: "DEATH", reason: "duplicate request", effectiveDate: today })).rejects.toBeInstanceOf(ConflictError);
    // Clerks can't approve by default.
    await expect(decideStatusRequest(db, clerk, req.id, true)).rejects.toBeInstanceOf(ForbiddenError);

    await decideStatusRequest(db, pastor, req.id, true, "Board minute 12/2026");
    const after = await db.member.findUniqueOrThrow({ where: { id: m.id }, include: { events: true, transfers: true } });
    expect(after.status).toBe("SELF_TRANSFERRED");
    expect(after.events).toHaveLength(1);
    expect(after.events[0]).toMatchObject({ type: "TRANSFER_OUT", title: "Transferred out to Ntinda SDA", approvedById: pastor.userId, fromStatus: "ACTIVE", toStatus: "SELF_TRANSFERRED" });
    expect(after.transfers[0]).toMatchObject({ stage: "BOARD_APPROVED", direction: "OUT" });
    const audit = await db.auditLog.findMany({ where: { memberId: m.id, source: "WORKFLOW" }, orderBy: { id: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["CREATE", "APPROVE", "UPDATE"]);
    expect(audit.find((a) => a.field === "status" && a.action === "UPDATE")).toMatchObject({ actorUserId: pastor.userId, oldValue: "ACTIVE", newValue: "SELF_TRANSFERRED" });
    await expect(decideStatusRequest(db, pastor, req.id, true)).rejects.toBeInstanceOf(ConflictError);

    // Letter then completion.
    const t = after.transfers[0];
    await expect(advanceTransfer(db, clerk, t.id, "LETTER_RECEIVED")).rejects.toBeInstanceOf(ValidationError);
    await expect(advanceTransfer(db, clerk, t.id, "COMPLETED")).rejects.toThrow(/letter/);
    await advanceTransfer(db, clerk, t.id, "LETTER_SENT");
    await advanceTransfer(db, clerk, t.id, "COMPLETED");
    expect((await db.transfer.findUniqueOrThrow({ where: { id: t.id } })).stage).toBe("COMPLETED");
  });

  it("approvers can't approve their own requests; rejection needs a reason and leaves status alone", async () => {
    const m = await activeMember("Own");
    const req = await createStatusRequest(db, pastor, { memberId: m.id, type: "DISCIPLINE", reason: "Board decision", effectiveDate: today });
    await expect(decideStatusRequest(db, pastor, req.id, true)).rejects.toThrow(/Someone else/);
    const otherPastor = await userWith(db, ["PASTOR"]);
    await expect(decideStatusRequest(db, otherPastor, req.id, false)).rejects.toBeInstanceOf(ValidationError);
    await decideStatusRequest(db, otherPastor, req.id, false, "Not yet discussed by the board");
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("ACTIVE");
    expect((await db.statusChangeRequest.findUniqueOrThrow({ where: { id: req.id } })).state).toBe("REJECTED");
  });

  it("death, discipline and restoration; discipline history hidden from non-sensitive roles", async () => {
    const m = await activeMember("Disc");
    await addMinistry(db, clerk, m.id, await listId(db, "MINISTRY", "Youth"), await listId(db, "MINISTRY_ROLE", "Member"));
    const d = await createStatusRequest(db, clerk, { memberId: m.id, type: "DISCIPLINE", reason: "Board decision 3/2026", effectiveDate: today });
    await decideStatusRequest(db, pastor, d.id, true);
    const r = await createStatusRequest(db, clerk, { memberId: m.id, type: "RESTORATION", reason: "Restored by the board", effectiveDate: today });
    await decideStatusRequest(db, pastor, r.id, true);
    const events = await db.membershipEvent.findMany({ where: { memberId: m.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.type)).toEqual(["DISCIPLINE", "RESTORATION"]);
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("ACTIVE");

    const dead = await activeMember("Dead");
    await expect(createStatusRequest(db, clerk, { memberId: dead.id, type: "DEATH", reason: "x", effectiveDate: today })).rejects.toThrow();
    const death = await createStatusRequest(db, clerk, { memberId: dead.id, type: "DEATH", reason: "Passed away at Mulago", effectiveDate: today });
    await decideStatusRequest(db, pastor, death.id, true);
    expect((await db.member.findUniqueOrThrow({ where: { id: dead.id } })).status).toBe("DECEASED");
    await expect(createStatusRequest(db, clerk, { memberId: dead.id, type: "DISCIPLINE", reason: "should fail", effectiveDate: today })).rejects.toThrow(/deceased/);
  });

  it("requests need status_request:create and in-scope members; cancel works", async () => {
    const m = await activeMember("Scope");
    const t = await userWith(db, ["TREASURER"]);
    await expect(createStatusRequest(db, t, { memberId: m.id, type: "DEATH", reason: "Passed away", effectiveDate: today })).rejects.toBeInstanceOf(ForbiddenError);
    const req = await createStatusRequest(db, clerk, { memberId: m.id, type: "STATUS_UPDATE", toStatus: "IRREGULAR", reason: "Not attended for a year", effectiveDate: today });
    const other = await userWith(db, ["ASSISTANT_CLERK"]);
    await expect(cancelStatusRequest(db, other, req.id)).rejects.toBeInstanceOf(ForbiddenError);
    await cancelStatusRequest(db, clerk, req.id);
    expect((await db.statusChangeRequest.findUniqueOrThrow({ where: { id: req.id } })).state).toBe("CANCELLED");
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
