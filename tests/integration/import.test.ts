import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { SYSTEM_ACTOR } from "@/server/audit/audit";
import { commitImport, prepareImport } from "@/server/import/register-import";
import { updateMember } from "@/server/members/service";
import { testDb, userWith } from "./helpers";

let db: Db;

/** Build a small fictitious register laid out like the clerk's (title rows, header on row 3). */
async function makeRegister(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["THE SEVENTHDAY ADVENTIST CHURCH KANYANYA"]);
  ws.addRow(["IDENTIFICATION", "", "", "", "CHURCH MEMBERSHIP DATABASE"]);
  ws.addRow([
    "Member ID", "Last Name", "First Name", "Gender", "Date of Birth", "Year joined church", "Physical Address",
    "Contact", "Email", "Membership", "Marital", "Name of Wife/ Husband", "Next of kin", "Profession", "Ministry", "Role",
  ]);
  for (const r of rows) ws.addRow(r);
  ws.addRow([{ formula: 'CONCAT("SDAK/M",TEXT(ROW(),"0000"))' }]); // template row: ID formula only
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const ROWS = [
  ["SDAK/M7001", "Ssekandi", "John", "Male", 1983, 2009, "Kanyanya", 774901335, null, "Active", "Married", "Nakato Jane", "Contact: 0703753832", "Teacher", "Deaconry", "Deacon"],
  ["SDAK/M7002", "Nakato", "Jane", "Female", "12/04/1985", 2010, "Kiyanja Zone", "0772 45 678", null, "Active", "Married", "Ssekandi John", null, "Nill", "Nil", "Member"],
  [null, "Atim", "Rebecca", "Female", null, null, "Lower Konge", null, null, null, null, null, null, null, "Health", "Asst. Head"],
  ["SDAK/M7003", "Ssekandi", "John B.", null, null, null, null, 774901335, null, null, null, null, null, null, null, null],
  ["SDAK/M7004", null, null, "Male", null, null, null, null, null, null, null, null, null, null, null, null],
];

beforeAll(async () => {
  db = await testDb();
});
afterAll(async () => {
  await db.$disconnect();
});

describe("register import", () => {
  let buffer: Buffer;
  let firstBatchId: string;

  it("validates: header detection, issues, cross-row duplicates", async () => {
    buffer = await makeRegister(ROWS);
    const p = await prepareImport(db, { name: "Register_test.xlsx", data: buffer });
    expect(p.headerRow).toBe(3);
    expect(p.rows).toHaveLength(5); // template row ignored
    const byRow = new Map(p.rows.map((r) => [r.rowNumber, r.normalized]));
    expect(byRow.get(5)!.issues.some((i) => i.field === "PHONE")).toBe(true);
    expect(byRow.get(7)!.issues.some((i) => /Same phone as row 4/.test(i.message))).toBe(true);
    expect(byRow.get(8)!.skip).toBe(true);
    expect(p.summary).toMatchObject({ rows: 5, skipped: 1 });
  });

  it("commits rows, logs each with its source row, and audits the creation", async () => {
    const p = await prepareImport(db, { name: "Register_test.xlsx", data: buffer });
    const batch = await commitImport(db, { ...SYSTEM_ACTOR, label: "System import" }, p);
    firstBatchId = batch.id;
    expect(batch.totals).toEqual({ created: 4, updated: 0, unchanged: 0, skipped: 1, errors: 0 });

    const john = await db.member.findUniqueOrThrow({ where: { memberNo: 7001 }, include: { ministries: { include: { ministry: true, role: true } }, zone: true, profession: true } });
    expect(john).toMatchObject({ memberId: "SDAK/M7001", phoneE164: "+256774901335", dobPrecision: "YEAR", dobYear: 1983, spouseName: "Nakato Jane", nextOfKinPhoneE164: "+256703753832" });
    expect(john.zone?.label).toBe("Kanyanya");
    expect(john.profession?.label).toBe("Teacher");
    expect(john.ministries.map((l) => `${l.ministry.label}/${l.role.label}`)).toEqual(["Deaconry/Deacon"]);

    const rows = await db.importRow.findMany({ where: { batchId: batch.id }, orderBy: { rowNumber: "asc" } });
    expect(rows.map((r) => [r.rowNumber, r.action])).toEqual([[4, "CREATE"], [5, "CREATE"], [6, "CREATE"], [7, "CREATE"], [8, "SKIP"]]);

    const audit = await db.auditLog.findFirstOrThrow({ where: { memberId: john.id, action: "CREATE" } });
    expect(audit).toMatchObject({ source: "IMPORT", actorLabel: "System import", note: "Register_test.xlsx, row 4", correlationId: batch.id });

    const raw = await db.rawValue.findMany({ where: { member: { memberNo: { in: [7002] } } } });
    expect(raw.map((r) => r.field)).toEqual(["PHONE"]);
  });

  it("issues rows without an ID a number above every ID in the file", async () => {
    const atim = await db.member.findFirstOrThrow({ where: { lastName: "Atim", firstName: "Rebecca" } });
    expect(atim.memberNo).toBeGreaterThan(7003);
  });

  it("is idempotent: re-running the same file changes nothing", async () => {
    const before = await db.member.count();
    const auditBefore = await db.auditLog.count();
    const p = await prepareImport(db, { name: "Register_test.xlsx", data: buffer });
    const batch = await commitImport(db, { ...SYSTEM_ACTOR, label: "System import" }, p);
    expect(batch.totals).toEqual({ created: 0, updated: 0, unchanged: 4, skipped: 1, errors: 0 });
    expect(await db.member.count()).toBe(before);
    expect(await db.auditLog.count()).toBe(auditBefore);
    expect(batch.id).not.toBe(firstBatchId);
  });

  it("never overwrites a clerk's correction, but fills new gaps", async () => {
    const clerk = await userWith(db, ["CHURCH_CLERK"]);
    const jane = await db.member.findUniqueOrThrow({ where: { memberNo: 7002 } });
    await updateMember(db, clerk, jane.id, { phone: "0772 456 789" });

    const changed = ROWS.map((r) => [...r]);
    changed[1][7] = "0700 000 001"; // register still has a different phone
    changed[1][12] = "Jane's Mother: 0701 234 567"; // new information
    const p = await prepareImport(db, { name: "Register_test_v2.xlsx", data: await makeRegister(changed) });
    const batch = await commitImport(db, { ...SYSTEM_ACTOR, label: "System import" }, p);
    // A different file (new hash): the ID-less row still matches its earlier record by name.
    expect(batch.totals).toMatchObject({ created: 0, updated: 1 });
    expect(await db.member.count({ where: { lastName: "Atim", firstName: "Rebecca" } })).toBe(1);

    const after = await db.member.findUniqueOrThrow({ where: { id: jane.id } });
    expect(after.phoneE164).toBe("+256772456789");
    expect(after.nextOfKinPhoneE164).toBe("+256701234567");
    const row = await db.importRow.findFirstOrThrow({ where: { batchId: batch.id, rowNumber: 5 } });
    expect(JSON.stringify(row.issues)).toMatch(/Kept the value already in the system for phoneE164/);
    const audit = await db.auditLog.findMany({ where: { memberId: jane.id, source: "IMPORT", action: "UPDATE" } });
    expect(audit.map((a) => a.field).sort()).toEqual(["nextOfKinName", "nextOfKinPhoneE164", "nextOfKinPhoneRaw"]);
  });
});
