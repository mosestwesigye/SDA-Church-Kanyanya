import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { getConferenceReturn, markReturnSent, reopenReturn, returnDetail, sabbathsOf, setReturnFigure, setSabbathAttendance } from "@/server/conference/service";
import { conferenceFormXlsx } from "@/server/conference/xlsx";
import { createMember } from "@/server/members/service";
import { buildReport, parseReportParams } from "@/server/reports/reports";
import { createStatusRequest } from "@/server/workflows/status";
import { testDb, userWith } from "./helpers";

let db: Db;
let clerk: Awaited<ReturnType<typeof userWith>>;
// A quarter long past, so other tests' activity (dated today) never lands in it.
const Q = { year: 2001, quarter: 2 };
const NEXT = { year: 2001, quarter: 3 };

beforeAll(async () => {
  db = await testDb();
  clerk = await userWith(db, ["CHURCH_CLERK"]);
  await db.conferenceReturn.deleteMany({ where: { year: 2001 } });
});
afterAll(async () => {
  await db.$disconnect();
});

const line = (r: Awaited<ReturnType<typeof getConferenceReturn>>, k: string) => r.lines.find((l) => l.key === k)!;

describe("conference statistical return", () => {
  it("lists the Sabbaths of the quarter", () => {
    const s = sabbathsOf(Q);
    expect(s[0]).toBe("2001-04-07");
    expect(s[1]).toBe("2001-04-14");
    expect(s[6]).toBe("2001-05-19");
    expect(s).toHaveLength(13);
  });

  it("counts baptisms, missing members and attendance from the register, and balances", async () => {
    const before = await getConferenceReturn(db, clerk, Q);
    const a = await createMember(db, clerk, { lastName: "Cuc", firstName: "Baptised" });
    await createStatusRequest(db, clerk, { memberId: a.id, type: "BAPTISM", reason: "Baptised at the camp meeting", effectiveDate: "2001-05-05" });
    expect((await db.member.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("ACTIVE");
    const b = await createMember(db, clerk, { lastName: "Cuc", firstName: "Gone", status: "ACTIVE" });
    await createStatusRequest(db, clerk, { memberId: b.id, type: "STATUS_UPDATE", toStatus: "MISSING", reason: "Whereabouts unknown, board vote", effectiveDate: "2001-05-12" });
    await setSabbathAttendance(db, clerk, { sabbath: "2001-04-14", count: 120 });
    await setSabbathAttendance(db, clerk, { sabbath: "2001-05-19", count: 130 });
    await expect(setSabbathAttendance(db, clerk, { sabbath: "2001-05-18", count: 1 })).rejects.toBeInstanceOf(ValidationError);

    const r = await getConferenceReturn(db, clerk, Q);
    expect(line(r, "baptism").value).toBe(line(before, "baptism").value! + 1);
    expect(line(r, "missing").value).toBe(line(before, "missing").value! + 1);
    expect(line(r, "att2").value).toBe(120);
    expect(line(r, "att7").value).toBe(130);
    expect(r.problems).toEqual([]);
    expect(r.closing).toBe(line(r, "opening").value! + r.added - r.dropped);
    expect((await returnDetail(db, clerk, Q, "baptism")).map((d) => d.memberId)).toContain(a.memberId);
  });

  it("lets the clerk replace a figure with a reason, then locks it once sent", async () => {
    await expect(setReturnFigure(db, clerk, Q, { key: "adjustIn", value: 3 })).rejects.toBeInstanceOf(ValidationError);
    await setReturnFigure(db, clerk, Q, { key: "adjustIn", value: 3, reason: "Members found in the old church book" });
    await setReturnFigure(db, clerk, Q, { key: "opening", value: 500, reason: "Last paper return" });
    let r = await getConferenceReturn(db, clerk, Q);
    expect(line(r, "adjustIn")).toMatchObject({ value: 3, computed: 0, override: { reason: "Members found in the old church book" } });
    expect(r.closing).toBe(500 + r.added - r.dropped);

    await markReturnSent(db, clerk, Q, { dateSent: "2001-07-08", pastorName: "Pr. Test" });
    await expect(setReturnFigure(db, clerk, Q, { key: "death", value: 1, reason: "late" })).rejects.toBeInstanceOf(ConflictError);
    r = await getConferenceReturn(db, clerk, Q);
    expect(r.state).toBe("SENT");

    // Next quarter opens with the figure that was sent.
    const next = await getConferenceReturn(db, clerk, NEXT);
    expect(next.openingFrom).toBe("previous");
    expect(line(next, "opening").value).toBe(r.closing);

    const xlsx = await conferenceFormXlsx(r);
    expect(xlsx.byteLength).toBeGreaterThan(4000);
    const report = await buildReport(db, clerk, "conference", parseReportParams("conference", { year: "2001", quarter: "2" }));
    expect(report.sections[1]!.table!.rows.find((x) => x.code === "6")!.figure).toBe(r.closing);

    await reopenReturn(db, clerk, Q, "Conference asked for a correction");
    expect((await getConferenceReturn(db, clerk, Q)).state).toBe("DRAFT");
    await setReturnFigure(db, clerk, Q, { key: "adjustIn", value: null });
    expect(line(await getConferenceReturn(db, clerk, Q), "adjustIn").override).toBeNull();
  });

  it("needs conference_return access; elders can view but not change", async () => {
    const elder = await userWith(db, ["ELDER"]);
    await getConferenceReturn(db, elder, Q);
    await expect(setReturnFigure(db, elder, Q, { key: "death", value: 1, reason: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    const treasurer = await userWith(db, ["TREASURER"]);
    await expect(getConferenceReturn(db, treasurer, Q)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
