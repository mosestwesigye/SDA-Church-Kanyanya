import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { ForbiddenError } from "@/server/errors";
import { logExport } from "@/server/exports/tabular";
import { addMinistry, createMember, updateMember } from "@/server/members/service";
import { reportPdf, reportXlsx } from "@/server/reports/render";
import { availableReports, buildReport, parseReportParams, quarterRange } from "@/server/reports/reports";
import { createStatusRequest, decideStatusRequest } from "@/server/workflows/status";
import { listId, testDb, userWith } from "./helpers";

let db: Db;
let clerk: Awaited<ReturnType<typeof userWith>>;
let pastor: Awaited<ReturnType<typeof userWith>>;
const now = new Date();
const year = now.getUTCFullYear();
const quarter = Math.floor(now.getUTCMonth() / 3) + 1;

beforeAll(async () => {
  db = await testDb();
  clerk = await userWith(db, ["CHURCH_CLERK"]);
  pastor = await userWith(db, ["PASTOR"]);
});
afterAll(async () => {
  await db.$disconnect();
});

const figure = (r: Awaited<ReturnType<typeof buildReport>>, heading: string, label: string) =>
  Number(r.sections.find((s) => s.heading === heading)!.summary!.find((x) => x.label === label)?.value ?? 0);

describe("report permissions", () => {
  it("needs report:read; profile reports need member.profile", async () => {
    const treasurer = await userWith(db, ["TREASURER"]);
    expect(availableReports(treasurer)).toEqual([]);
    await expect(buildReport(db, treasurer, "zones", parseReportParams("zones", {}))).rejects.toBeInstanceOf(ForbiddenError);
    expect(availableReports(clerk)).toEqual([
      "quarterly", "overview", "movements", "status", "age-groups", "ministry-roster", "zones", "families", "birthdays", "data-quality", "minutes",
    ]);
    // Families need sensitive access; minutes need minutes access.
    const elder = await userWith(db, ["ELDER"]);
    expect(availableReports(elder)).toContain("minutes");
    const head = await userWith(db, ["MINISTRY_HEAD"], { ministryLabels: ["Youth"] });
    expect(availableReports(head)).not.toContain("families");
    expect(availableReports(head)).not.toContain("minutes");
    await expect(buildReport(db, head, "minutes", parseReportParams("minutes", {}))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("elders can preview but not download (export is logged and needs export:run)", async () => {
    await createMember(db, clerk, { lastName: "Rep", firstName: "Elderview" });
    const elder = await userWith(db, ["ELDER"]);
    const r = await buildReport(db, elder, "status", parseReportParams("status", {}));
    expect(r.rowCount).toBeGreaterThan(0);
    await expect(logExport(db, elder, { kind: "report:status", format: "pdf", filters: {}, fields: [], rowCount: r.rowCount })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a ministry head only gets their ministry's members, and only their own roster", async () => {
    const m = await createMember(db, clerk, { lastName: "Rep", firstName: "Helper", phone: "0772 123456" });
    await addMinistry(db, clerk, m.id, await listId(db, "MINISTRY", "Welfare"), await listId(db, "MINISTRY_ROLE", "Member"));
    const outsider = await createMember(db, clerk, { lastName: "Rep", firstName: "Outsider" });
    const head = await userWith(db, ["MINISTRY_HEAD"], { ministryLabels: ["Welfare"] });

    const zones = await buildReport(db, head, "zones", parseReportParams("zones", {}));
    const ids = zones.sections.flatMap((s) => s.table?.rows.map((r) => r.memberId) ?? []);
    expect(ids).toContain(m.memberId);
    expect(ids).not.toContain(outsider.memberId);

    await expect(buildReport(db, head, "ministry-roster", { ministry: await listId(db, "MINISTRY", "Youth") })).rejects.toBeInstanceOf(ForbiddenError);
    const roster = await buildReport(db, head, "ministry-roster", { ministry: await listId(db, "MINISTRY", "Welfare") });
    const row = roster.sections.find((s) => s.table)!.table!.rows.find((r) => r.memberId === m.memberId)!;
    expect(row).toMatchObject({ role: "Member", phone: "0772 123 456" });
  });

  it("drops columns from field groups the viewer cannot read", async () => {
    // A role with profile but no contact access: phone must not appear at all.
    await db.role.upsert({ where: { key: "REPORT_TEST" }, create: { key: "REPORT_TEST", name: "Report test", isSystem: false }, update: {} });
    const role = await db.role.findUniqueOrThrow({ where: { key: "REPORT_TEST" } });
    for (const [resource, action] of [["member", "read"], ["member.profile", "read"], ["report", "read"]]) {
      await db.permission.upsert({
        where: { roleId_resource_action: { roleId: role.id, resource, action } },
        create: { roleId: role.id, resource, action, scope: "ALL" },
        update: {},
      });
    }
    const u = await userWith(db, ["PASTOR"]);
    await db.userRole.deleteMany({ where: { userId: u.userId } });
    await db.userRole.create({ data: { userId: u.userId, roleId: role.id } });
    const { loadAuthContext } = await import("@/server/authz/context");
    const ctx = await loadAuthContext(db, u.userId, { sessionId: "s-rep", ipAddress: "127.0.0.1" });
    const r = await buildReport(db, ctx, "zones", parseReportParams("zones", {}));
    expect(r.omitted).toContain("Phone");
    expect(r.sections.filter((s) => s.table).every((s) => !s.table!.columns.some((c) => c.key === "phone"))).toBe(true);
  });
});

describe("quarterly report", () => {
  it("counts an approved death as a loss in its quarter and keeps earlier quarters' closing figure", async () => {
    const m = await createMember(db, clerk, { lastName: "Quarter", firstName: "Loss" });
    await updateMember(db, clerk, m.id, { status: "ACTIVE" });
    const prevQ = quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 };

    const before = await buildReport(db, clerk, "quarterly", { year, quarter });
    const prevBefore = await buildReport(db, clerk, "quarterly", prevQ);

    const req = await createStatusRequest(db, clerk, { memberId: m.id, type: "DEATH", reason: "Passed away at home", effectiveDate: now.toISOString().slice(0, 10) });
    await decideStatusRequest(db, pastor, req.id, true);

    const after = await buildReport(db, clerk, "quarterly", { year, quarter });
    expect(figure(after, "Membership", "Losses")).toBe(figure(before, "Membership", "Losses") + 1);
    expect(figure(after, "Membership", "Membership at end of quarter")).toBe(figure(before, "Membership", "Membership at end of quarter") - 1);
    expect(figure(after, "Membership", "Membership at start of quarter")).toBe(figure(before, "Membership", "Membership at start of quarter"));
    expect(figure(after, "Losses by type", "Death")).toBeGreaterThanOrEqual(1);
    const changes = after.sections.find((s) => s.table)!.table!.rows;
    expect(changes.find((r) => r.memberId === m.memberId)).toMatchObject({ type: "Death", direction: "Loss" });

    // Movement after the previous quarter ended must not change its closing figure.
    const prevAfter = await buildReport(db, clerk, "quarterly", prevQ);
    expect(figure(prevAfter, "Membership", "Membership at end of quarter")).toBe(figure(prevBefore, "Membership", "Membership at end of quarter"));
  });

  it("quarter ranges cover whole months", () => {
    expect(quarterRange(2026, 1)).toEqual({ start: new Date("2026-01-01T00:00:00Z"), end: new Date("2026-03-31T00:00:00Z") });
    expect(quarterRange(2024, 4).end).toEqual(new Date("2024-12-31T00:00:00Z"));
  });
});

describe("birthday report", () => {
  it("lists full-DOB members of the month only", async () => {
    const full = await createMember(db, clerk, { lastName: "Bday", firstName: "March", dobPrecision: "FULL", dobDate: "1985-03-14" });
    const yearOnly = await createMember(db, clerk, { lastName: "Bday", firstName: "YearOnlyMarch", dobPrecision: "YEAR", dobYear: 1985 });
    const r = await buildReport(db, clerk, "birthdays", { month: 3 });
    const rows = r.sections[0]!.table!.rows;
    expect(rows.find((x) => x.memberId === full.memberId)).toMatchObject({ day: 14 });
    expect(rows.some((x) => x.memberId === yearOnly.memberId)).toBe(false);
    expect(rows.every((x, i) => i === 0 || Number(rows[i - 1]!.day) <= Number(x.day))).toBe(true);
  });
});

describe("more reports", () => {
  it("age groups place members by age and leave out the deceased", async () => {
    const y = now.getUTCFullYear();
    const kid = await createMember(db, clerk, { lastName: "Age", firstName: "Pathfinder", dobPrecision: "YEAR", dobYear: y - 12 });
    const late = await createMember(db, clerk, { lastName: "Age", firstName: "Late", dobPrecision: "YEAR", dobYear: y - 12 });
    await updateMember(db, clerk, late.id, { status: "DECEASED" });
    const r = await buildReport(db, clerk, "age-groups", parseReportParams("age-groups", { group: "pathfinders" }));
    const ids = r.sections.flatMap((s) => s.table?.rows.map((x) => x.memberId) ?? []);
    expect(ids).toContain(kid.memberId);
    expect(ids).not.toContain(late.memberId);
    expect(r.sections[0]!.summary!.map((s) => s.label)).toEqual(["Pathfinders (10–15)"]);
  });

  it("membership changes cover a date range and count gains and losses", async () => {
    const m = await createMember(db, clerk, { lastName: "Moves", firstName: "Range" });
    await updateMember(db, clerk, m.id, { status: "ACTIVE" });
    const req = await createStatusRequest(db, clerk, { memberId: m.id, type: "DEATH", reason: "Passed away", effectiveDate: now.toISOString().slice(0, 10) });
    await decideStatusRequest(db, pastor, req.id, true);
    const today = now.toISOString().slice(0, 10);
    const r = await buildReport(db, clerk, "movements", parseReportParams("movements", { from: today, to: today, type: "DEATH" }));
    const row = r.sections.find((s) => s.table)!.table!.rows.find((x) => x.memberId === m.memberId);
    expect(row).toMatchObject({ type: "Death", direction: "Loss" });
    expect(Number(r.sections[0]!.summary!.find((s) => s.label === "Losses from membership")!.value)).toBeGreaterThanOrEqual(1);
  });

  it("records needing attention list what is missing, least complete first", async () => {
    const m = await createMember(db, clerk, { lastName: "Quality", firstName: "Sparse" });
    const r = await buildReport(db, clerk, "data-quality", parseReportParams("data-quality", { below: "50" }));
    const rows = r.sections.find((s) => s.table)!.table!.rows;
    const row = rows.find((x) => x.memberId === m.memberId)!;
    expect(String(row.missing)).toContain("Phone");
    expect(rows.every((x, i) => i === 0 || parseInt(String(rows[i - 1]!.completeness)) <= parseInt(String(x.completeness)))).toBe(true);
  });

  it("every report renders as PDF and Excel", async () => {
    for (const key of availableReports(clerk)) {
      const r = await buildReport(db, clerk, key, parseReportParams(key, {}));
      expect(Buffer.from((await reportPdf(r)).slice(0, 5)).toString()).toBe("%PDF-");
      expect((await reportXlsx(r)).byteLength).toBeGreaterThan(0);
    }
  });

  it("overview and families build for the clerk", async () => {
    const o = await buildReport(db, clerk, "overview", parseReportParams("overview", {}));
    expect(o.sections.map((s) => s.heading)).toContain("Membership status");
    const f = await buildReport(db, clerk, "families", parseReportParams("families", {}));
    expect(f.sections[0]!.heading).toBe("Summary");
  });
});

describe("rendering and logging", () => {
  it("renders PDF and Excel safely and logs the download", async () => {
    await createMember(db, clerk, { lastName: "=HYPERLINK(\"x\")", firstName: "Ŋanda → Test" });
    const r = await buildReport(db, clerk, "status", parseReportParams("status", {}));
    const pdf = await reportPdf(r);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await reportXlsx(r)) as unknown as ArrayBuffer);
    expect(wb.worksheets[0]!.name).toBe("Summary");
    const values = wb.worksheets.flatMap((ws) => ws.getSheetValues().flat().map(String));
    expect(values.some((v) => v.startsWith("=HYPERLINK"))).toBe(false);
    expect(values.some((v) => v.startsWith("'=HYPERLINK"))).toBe(true);
    expect(values.some((v) => v.includes("Data Protection and Privacy Act"))).toBe(true);

    const before = await db.exportLog.count({ where: { userId: clerk.userId, kind: "report:status" } });
    await logExport(db, clerk, { kind: "report:status", format: "pdf", filters: {}, fields: ["memberId"], rowCount: r.rowCount });
    expect(await db.exportLog.count({ where: { userId: clerk.userId, kind: "report:status" } })).toBe(before + 1);
    const audit = await db.auditLog.findFirstOrThrow({ where: { actorUserId: clerk.userId, action: "EXPORT" }, orderBy: { id: "desc" } });
    expect(audit.newValue).toMatchObject({ kind: "report:status", format: "pdf" });
  });
});
