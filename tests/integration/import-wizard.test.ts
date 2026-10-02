import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { commitBatch, commitBatchSkippingErrors, describeBatch, saveMapping, startImport, validateBatch } from "@/server/import/wizard";
import { testDb, userWith } from "./helpers";

let db: Db;
let clerk: Awaited<ReturnType<typeof userWith>>;
const BASE = 8000 + Math.floor(Math.random() * 900);

/** Fictitious register with non-standard header wording on row 2. */
async function workbook(rows: unknown[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Members 2026");
  ws.addRow(["SDA CHURCH KANYANYA — REGISTER"]);
  ws.addRow(["ID", "Surname", "Other names", "Sex", "Mobile", "Zone", "Department", "Position"]);
  for (const r of rows) ws.addRow(r);
  wb.addWorksheet("Notes").addRow(["nothing here"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const id = (n: number) => `SDAK/M${BASE + n}`;

beforeAll(async () => {
  db = await testDb();
  clerk = await userWith(db, ["CHURCH_CLERK"]);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("import wizard", () => {
  it("only import:run roles can upload, and only .xlsx is accepted", async () => {
    const asst = await userWith(db, ["ASSISTANT_CLERK"]);
    const file = { name: "r.xlsx", data: await workbook([[id(1), "Wizardtest", "David", "Male", "0772 100 900", "Kanyanya", "Youth", "Member"]]) };
    await expect(startImport(db, asst, file)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(startImport(db, clerk, { name: "r.csv", data: Buffer.from("a,b,c") })).rejects.toBeInstanceOf(ValidationError);
  });

  it("detects the sheet and headers, previews actions, commits, and is idempotent", async () => {
    const data = await workbook([
      [id(1), "Wizardtest", "David", "Male", "0772 100 900", "Kanyanya", "Youth", "Member"],
      [id(2), "Wizardtest", "Rebecca", "Female", "0772 45 678", "Wizardville", "Health", "Asst. Head"],
      ["BAD-ID", "Nobody", "Here", null, null, null, null, null],
    ]);
    const { batch } = await startImport(db, clerk, { name: "register.xlsx", data });
    expect(batch).toMatchObject({ status: "UPLOADED", sheetName: "Members 2026", headerRow: 2 });
    const { workbook: wb } = await describeBatch(db, clerk, batch.id);
    expect(wb.sheets.map((s) => s.name)).toEqual(["Members 2026", "Notes"]);
    expect(Object.keys(wb.sheets[0].detected).sort()).toEqual(["firstName", "gender", "lastName", "memberId", "ministry", "phone", "role", "zone"].sort());

    // One column can't feed two fields.
    await expect(saveMapping(db, clerk, batch.id, { sheetName: "Members 2026", headerRow: 2, columnMap: { lastName: 2, firstName: 2 } })).rejects.toBeInstanceOf(ValidationError);

    const v = await validateBatch(db, clerk, batch.id);
    expect(v.actions).toMatchObject({ CREATE: 2, ERROR: 1 });
    expect(v.prepared.rows.find((r) => r.rowNumber === 4)!.normalized.issues.map((i) => i.field)).toEqual(expect.arrayContaining(["ZONE", "PHONE"]));
    // Members untouched by validation.
    expect(await db.member.count({ where: { memberNo: { in: [BASE + 1, BASE + 2] } } })).toBe(0);

    // Errors block a normal commit; skipping them is explicit.
    await expect(commitBatch(db, clerk, batch.id)).rejects.toThrow(/errors/);
    const done = await commitBatchSkippingErrors(db, clerk, batch.id);
    expect(done.totals).toMatchObject({ created: 2, errors: 1 });
    await expect(commitBatchSkippingErrors(db, clerk, batch.id)).rejects.toThrow(/already committed/);
    const rows = await db.importRow.findMany({ where: { batchId: batch.id }, orderBy: { rowNumber: "asc" } });
    expect(rows.map((r) => [r.rowNumber, r.action])).toEqual([[3, "CREATE"], [4, "CREATE"], [5, "ERROR"]]);
    expect(await db.auditLog.count({ where: { correlationId: batch.id, action: "CREATE", entity: "Member" } })).toBe(2);

    // Same register again (with one new phone): the preview and commit show no duplicates.
    const again = await startImport(db, clerk, {
      name: "register-v2.xlsx",
      data: await workbook([
        [id(1), "Wizardtest", "David", "Male", "0772 100 900", "Kanyanya", "Youth", "Member"],
        [id(2), "Wizardtest", "Rebecca", "Female", "0772 456 780", "Wizardville", "Health", "Asst. Head"],
      ]),
    });
    const v2 = await validateBatch(db, clerk, again.batch.id);
    expect(v2.actions).toEqual({ UNCHANGED: 1, UPDATE: 1 });
    expect(v2.preview.find((p) => p.action === "UPDATE")!.changes).toEqual(["phoneE164"]);
    const done2 = await commitBatch(db, clerk, again.batch.id);
    expect(done2.totals).toMatchObject({ created: 0, updated: 1, unchanged: 1 });
    expect(await db.member.count({ where: { memberNo: { in: [BASE + 1, BASE + 2] } } })).toBe(2);
  });

  it("a manual mapping on a different header row is honoured", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Raw");
    ws.addRow(["x", "y", "z"]);
    ws.addRow(["Col A", "Col B", "Col C"]); // headings the detector can't recognise
    ws.addRow([id(50), "Kintu", "Moses"]);
    const { batch } = await startImport(db, clerk, { name: "raw.xlsx", data: Buffer.from(await wb.xlsx.writeBuffer()) });
    await saveMapping(db, clerk, batch.id, { sheetName: "Raw", headerRow: 2, columnMap: { memberId: 1, lastName: 2, firstName: 3 } });
    const v = await validateBatch(db, clerk, batch.id);
    expect(v.prepared.rows).toHaveLength(1);
    expect(v.prepared.rows[0].normalized.columns).toMatchObject({ lastName: "Kintu", firstName: "Moses" });
    expect(v.prepared.rows[0].normalized.memberNo).toBe(BASE + 50);
  });
});
