import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { dashboardStats } from "@/server/dashboard/stats";
import { activateMembers, dormantCounts, listDormant, requestReactivation } from "@/server/members/dormant";
import { createMember, updateMember } from "@/server/members/service";
import { buildReport, parseReportParams } from "@/server/reports/reports";
import { createStatusRequest, decideStatusRequest } from "@/server/workflows/status";
import { testDb, userWith } from "./helpers";

let db: Db;
let clerk: Awaited<ReturnType<typeof userWith>>;
let pastor: Awaited<ReturnType<typeof userWith>>;
const today = new Date().toISOString().slice(0, 10);
const tag = Date.now().toString(36);

beforeAll(async () => {
  db = await testDb();
  clerk = await userWith(db, ["CHURCH_CLERK"]);
  pastor = await userWith(db, ["PASTOR"]);
});
afterAll(async () => {
  await db.$disconnect();
});

const inStatusReport = async (memberId: string) => {
  const r = await buildReport(db, clerk, "status", parseReportParams("status", {}));
  return r.sections.some((s) => s.table?.rows.some((x) => x.memberId === memberId));
};

describe("active register and dormant members", () => {
  it("reports and the dashboard count only Active and Irregular members", async () => {
    const before = await dashboardStats(db, clerk);
    const active = await createMember(db, clerk, { lastName: `Reg${tag}`, firstName: "Active", status: "ACTIVE" });
    const none = await createMember(db, clerk, { lastName: `Reg${tag}`, firstName: "NoStatus" });
    const after = await dashboardStats(db, clerk);
    expect(after.total).toBe(before.total + 1);
    expect(after.dormant).toBe((before.dormant ?? 0) + 1);
    expect(after.status.map((s) => s.key)).toEqual(["ACTIVE", "IRREGULAR"]);
    expect(await inStatusReport(active.memberId)).toBe(true);
    expect(await inStatusReport(none.memberId)).toBe(false);
  });

  it("lists dormant members by group and moves members without a status to the active register (audited)", async () => {
    const a = await createMember(db, clerk, { lastName: `Dorm${tag}`, firstName: "One" });
    const b = await createMember(db, clerk, { lastName: `Dorm${tag}`, firstName: "Two" });
    const list = await listDormant(db, clerk, { tab: "none", q: `Dorm${tag}` });
    expect(list.rows.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    const counts = await dormantCounts(db, clerk);
    expect(counts.none).toBeGreaterThanOrEqual(2);

    const res = await activateMembers(db, clerk, [a.id, b.id], "IRREGULAR");
    expect(res).toEqual({ done: 2, skipped: 0 });
    expect((await listDormant(db, clerk, { tab: "none", q: `Dorm${tag}` })).rows).toHaveLength(0);
    expect(await inStatusReport(a.memberId)).toBe(true);
    expect(await db.auditLog.count({ where: { memberId: a.id, field: "status" } })).toBe(1);
  });

  it("members with a dormant status come back only through an approved request", async () => {
    const m = await createMember(db, clerk, { lastName: `Back${tag}`, firstName: "Transferred" });
    await updateMember(db, clerk, m.id, { status: "SELF_TRANSFERRED" });
    expect(await activateMembers(db, clerk, [m.id], "ACTIVE")).toEqual({ done: 0, skipped: 1 });
    expect((await listDormant(db, clerk, { tab: "self", q: `Back${tag}` })).rows).toHaveLength(1);

    await expect(requestReactivation(db, clerk, { memberId: m.id, toStatus: "ACTIVE", reason: "x", effectiveDate: today })).rejects.toThrow();
    const req = await requestReactivation(db, clerk, { memberId: m.id, toStatus: "ACTIVE", reason: "Back and attending every Sabbath", effectiveDate: today });
    const listed = await listDormant(db, clerk, { tab: "self", q: `Back${tag}` });
    expect(listed.rows[0]!.pendingTo).toBe("ACTIVE");
    expect(await inStatusReport(m.memberId)).toBe(false);
    await decideStatusRequest(db, pastor, req.id, true);
    expect(await inStatusReport(m.memberId)).toBe(true);
  });

  it("restores members under discipline, never reactivates the deceased, and needs status access", async () => {
    const d = await createMember(db, clerk, { lastName: `Disc${tag}`, firstName: "Member", status: "ACTIVE" });
    const r = await createStatusRequest(db, clerk, { memberId: d.id, type: "DISCIPLINE", reason: "Board decision of the month", effectiveDate: today });
    await decideStatusRequest(db, pastor, r.id, true);
    const back = await requestReactivation(db, clerk, { memberId: d.id, toStatus: "ACTIVE", reason: "Restored by board vote", effectiveDate: today });
    expect(back.type).toBe("RESTORATION");

    const late = await createMember(db, clerk, { lastName: `Late${tag}`, firstName: "Member" });
    await updateMember(db, clerk, late.id, { status: "DECEASED" });
    await expect(requestReactivation(db, clerk, { memberId: late.id, toStatus: "ACTIVE", reason: "Should not work", effectiveDate: today })).rejects.toBeInstanceOf(ValidationError);
    expect((await listDormant(db, clerk, { tab: "all", q: `Late${tag}` })).rows).toHaveLength(0);
    expect((await listDormant(db, clerk, { tab: "deceased", q: `Late${tag}` })).rows).toHaveLength(1);

    const treasurer = await userWith(db, ["TREASURER"]);
    await expect(listDormant(db, treasurer, {})).rejects.toBeInstanceOf(ForbiddenError);
    const elder = await userWith(db, ["ELDER"]);
    const x = await createMember(db, clerk, { lastName: `Elder${tag}`, firstName: "Try" });
    await expect(activateMembers(db, elder, [x.id], "ACTIVE")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
