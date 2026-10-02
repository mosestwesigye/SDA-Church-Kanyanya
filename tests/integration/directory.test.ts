import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { buildMemberExport } from "@/server/exports/members";
import { logExport, renderTable } from "@/server/exports/tabular";
import { findDuplicateCandidates, isStrongDuplicate } from "@/server/members/duplicates";
import { listMembers, parseDirectoryQuery } from "@/server/members/directory";
import { setMemberPhoto, openDocument, uploadDocument } from "@/server/members/documents";
import { getMemberProfile } from "@/server/members/profile";
import { addMinistry, createMember, flagForReview, removeMinistry, softDeleteMember, updateMember } from "@/server/members/service";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { listId, testDb, userWith } from "./helpers";

let db: Db;
let clerk: Awaited<ReturnType<typeof userWith>>;
const TAG = `Dir${Date.now().toString(36)}`; // unique surname prefix for this file
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = await testDb();
  clerk = await userWith(db, ["CHURCH_CLERK"]);
  const member = await listId(db, "MINISTRY_ROLE", "Member");
  const mk = async (key: string, fields: Record<string, unknown>, ministry?: string) => {
    const m = await createMember(db, clerk, { lastName: `${TAG}${key}`, ...fields } as never);
    if (ministry) await addMinistry(db, clerk, m.id, await listId(db, "MINISTRY", ministry), member);
    ids[key] = m.id;
  };
  await mk("Alpha", { firstName: "Grace", phone: "0772 100 001", status: "ACTIVE", zoneId: await listId(db, "ZONE", "Kanyanya"), maritalStatus: "MARRIED", nextOfKinName: "Kin Alpha" }, "Youth");
  await mk("Beta", { firstName: "David", phone: "0772 100 002", status: "IRREGULAR" }, "Church Choir");
  await mk("Gamma", { firstName: "Esther" });
});
afterAll(async () => {
  await db.$disconnect();
});

const q = (sp: Record<string, string> = {}) => parseDirectoryQuery({ q: TAG, ...sp });

describe("directory search and filters", () => {
  it("finds by name, ID and phone", async () => {
    const alpha = await db.member.findUniqueOrThrow({ where: { id: ids.Alpha } });
    expect((await listMembers(db, clerk, q())).total).toBe(3);
    expect((await listMembers(db, clerk, parseDirectoryQuery({ q: alpha.memberId }))).rows.map((r) => r.id)).toEqual([ids.Alpha]);
    expect((await listMembers(db, clerk, parseDirectoryQuery({ q: String(alpha.memberNo) }))).rows.map((r) => r.id)).toContain(ids.Alpha);
    expect((await listMembers(db, clerk, parseDirectoryQuery({ q: "0772100002" }))).rows.map((r) => r.id)).toEqual([ids.Beta]);
    expect((await listMembers(db, clerk, parseDirectoryQuery({ q: "+256772100001" }))).rows.map((r) => r.id)).toEqual([ids.Alpha]);
  });

  it("filters by status (including not recorded), ministry, zone and profile", async () => {
    const youth = await listId(db, "MINISTRY", "Youth");
    const zone = await listId(db, "ZONE", "Kanyanya");
    expect((await listMembers(db, clerk, q({ status: "ACTIVE,IRREGULAR" }))).total).toBe(2);
    expect((await listMembers(db, clerk, q({ status: "NONE" }))).rows.map((r) => r.id)).toEqual([ids.Gamma]);
    expect((await listMembers(db, clerk, q({ ministry: youth }))).rows.map((r) => r.id)).toEqual([ids.Alpha]);
    expect((await listMembers(db, clerk, q({ zone }))).rows.map((r) => r.id)).toEqual([ids.Alpha]);
    expect((await listMembers(db, clerk, q({ profile: "nameonly" }))).rows.map((r) => r.id)).toEqual([ids.Gamma]);
  });

  it("ignores sensitive and contact filters for roles that can't see them", async () => {
    // A treasurer may not search by phone or filter by marital status: those params are ignored, not leaked.
    const t = await userWith(db, ["TREASURER"]);
    expect((await listMembers(db, t, parseDirectoryQuery({ q: "0772100002" }))).total).toBe(0);
    expect((await listMembers(db, t, q({ marital: "MARRIED" }))).total).toBe(3);
    // A ministry head can search phones of their own ministries' members, but not filter by marital status.
    const head = await userWith(db, ["MINISTRY_HEAD"], { ministryLabels: ["Youth", "Church Choir"] });
    expect((await listMembers(db, head, parseDirectoryQuery({ q: "0772100002" }))).rows.map((r) => r.id)).toEqual([ids.Beta]);
    expect((await listMembers(db, head, q({ marital: "MARRIED" }))).total).toBe(2);
  });

  it("hides deleted members except in Recently deleted (for roles that can restore)", async () => {
    const m = await createMember(db, clerk, { lastName: `${TAG}Delta`, firstName: "Gone" });
    await softDeleteMember(db, clerk, m.id, "test");
    expect((await listMembers(db, clerk, q())).rows.map((r) => r.id)).not.toContain(m.id);
    expect((await listMembers(db, clerk, q({ deleted: "1" }))).rows.map((r) => r.id)).toEqual([m.id]);
    const asst = await userWith(db, ["ASSISTANT_CLERK"]);
    expect((await listMembers(db, asst, q({ deleted: "1" }))).rows.map((r) => r.id)).not.toContain(m.id);
  });
});

describe("export", () => {
  it("drops restricted columns entirely and logs the export", async () => {
    const t = await userWith(db, ["TREASURER", "MINISTRY_HEAD"]);
    // Treasurer+Head may not export at all by default.
    await expect(buildMemberExport(db, t, q(), {})).rejects.toBeInstanceOf(ForbiddenError);

    const asst = await userWith(db, ["ASSISTANT_CLERK"]);
    const table = await buildMemberExport(db, asst, q(), { columns: ["phone", "marital", "nextOfKin"] });
    expect(table.columns.map((c) => c.key)).toEqual(["memberId", "lastName", "firstName", "phone", "marital", "spouse", "nextOfKin", "nextOfKinPhone"]);
    expect(table.rows).toHaveLength(3);

    await logExport(db, asst, { kind: "members", format: "xlsx", filters: {}, fields: table.columns.map((c) => c.key), rowCount: 3 });
    const log = await db.exportLog.findFirstOrThrow({ where: { userId: asst.userId } });
    expect(log).toMatchObject({ kind: "members", rowCount: 3, noticeShown: true });
    expect(await db.auditLog.count({ where: { actorUserId: asst.userId, action: "EXPORT" } })).toBe(1);
  });

  it("pastor exports sensitive columns; elder cannot export", async () => {
    const pastor = await userWith(db, ["PASTOR"]);
    const table = await buildMemberExport(db, pastor, q(), {});
    expect(table.columns.map((c) => c.key)).toContain("nextOfKin");
    const elder = await userWith(db, ["ELDER"]);
    await expect(buildMemberExport(db, elder, q(), {})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("writes a real xlsx with the privacy notice, and CSV guarded against formula injection", async () => {
    const table = { title: "T", columns: [{ key: "a", label: "A" }], rows: [{ a: "=HYPERLINK(1)" }, { a: "ok" }] };
    const csv = (await renderTable(table, "csv", { generatedBy: "x" })).toString("utf8");
    expect(csv).toContain("'=HYPERLINK(1)");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderTable(table, "xlsx", { generatedBy: "Tester" })) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(String(ws.getRow(2).getCell(1).value)).toMatch(/Data Protection and Privacy Act, 2019/);
    expect(ws.getRow(4).getCell(1).value).toBe("A");
    expect(ws.getRow(5).getCell(1).value).toBe("=HYPERLINK(1)"); // stored as text, not a formula
  });
});

describe("duplicate detection", () => {
  it("flags same phone and similar names (either name order)", async () => {
    const byPhone = await findDuplicateCandidates(db, clerk, { lastName: "Someone", firstName: "Else", phone: "0772100001" });
    expect(byPhone[0]).toMatchObject({ id: ids.Alpha, samePhone: true });
    expect(isStrongDuplicate(byPhone[0])).toBe(true);

    const byName = await findDuplicateCandidates(db, clerk, { lastName: `${TAG}Beta`, firstName: "Davd" });
    expect(byName.map((d) => d.id)).toContain(ids.Beta);
    const swapped = await findDuplicateCandidates(db, clerk, { lastName: "David", firstName: `${TAG}Beta` });
    expect(swapped.map((d) => d.id)).toContain(ids.Beta);
  });

  it("excludes the record being edited and respects scope", async () => {
    const self = await findDuplicateCandidates(db, clerk, { lastName: `${TAG}Alpha`, firstName: "Grace", excludeId: ids.Alpha });
    expect(self.map((d) => d.id)).not.toContain(ids.Alpha);
    const head = await userWith(db, ["MINISTRY_HEAD"], { ministryLabels: ["Church Choir"] });
    const scoped = await findDuplicateCandidates(db, head, { lastName: `${TAG}Alpha`, firstName: "Grace" });
    expect(scoped.map((d) => d.id)).not.toContain(ids.Alpha);
  });
});

describe("profile actions", () => {
  it("removing a ministry is audited and lowers completeness", async () => {
    const before = await db.member.findUniqueOrThrow({ where: { id: ids.Beta }, include: { ministries: true } });
    await removeMinistry(db, clerk, before.ministries[0].id);
    const after = await db.member.findUniqueOrThrow({ where: { id: ids.Beta } });
    expect(after.missingFields).toContain("ministry");
    expect(after.completeness).toBeLessThan(before.completeness);
    expect(await db.auditLog.count({ where: { memberId: ids.Beta, entity: "MemberMinistry", action: "DELETE" } })).toBe(1);
  });

  it("send to clean-up queue flags once and is audited", async () => {
    expect(await flagForReview(db, clerk, [ids.Gamma, ids.Beta], "Check phone")).toBe(2);
    expect(await flagForReview(db, clerk, [ids.Gamma], "again")).toBe(0);
    expect((await listMembers(db, clerk, q({ flagged: "1" }))).total).toBe(2);
    const elder = await userWith(db, ["ELDER"]);
    await expect(flagForReview(db, elder, [ids.Gamma], "x")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("photos: content is sniffed, permission is enforced, completeness updates", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001", "hex");
    await expect(setMemberPhoto(db, clerk, ids.Gamma, { data: Buffer.from("not an image"), name: "x.png" })).rejects.toBeInstanceOf(ValidationError);
    const elder = await userWith(db, ["ELDER"]);
    await expect(setMemberPhoto(db, elder, ids.Gamma, { data: png, name: "p.png" })).rejects.toBeInstanceOf(ForbiddenError);
    await setMemberPhoto(db, clerk, ids.Gamma, { data: png, name: "p.png" });
    const m = await db.member.findUniqueOrThrow({ where: { id: ids.Gamma } });
    expect(m.photoKey).toBeTruthy();
    expect(m.missingFields).not.toContain("photo");
    const doc = await db.document.findFirstOrThrow({ where: { memberId: ids.Gamma, kind: "PHOTO" } });
    const t = await userWith(db, ["TREASURER"]);
    await expect(openDocument(db, t, doc.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await openDocument(db, elder, doc.id)).doc.id).toBe(doc.id);
  });

  it("documents need document permissions", async () => {
    const pdf = Buffer.from("%PDF-1.4\n%fake\n");
    const head = await userWith(db, ["MINISTRY_HEAD"], { ministryLabels: ["Youth"] });
    await expect(uploadDocument(db, head, ids.Alpha, "CONSENT_FORM", { data: pdf, name: "c.pdf" })).rejects.toBeInstanceOf(ForbiddenError);
    const doc = await uploadDocument(db, clerk, ids.Alpha, "CONSENT_FORM", { data: pdf, name: "c.pdf" });
    await expect(openDocument(db, head, doc.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.auditLog.count({ where: { entity: "Document", entityId: doc.id } })).toBe(1);
  });

  it("profile hides discipline history and masks sensitive audit values for other roles", async () => {
    await db.membershipEvent.create({ data: { memberId: ids.Alpha, type: "DISCIPLINE", title: "Placed under discipline", occurredOn: new Date("2025-01-01") } });
    await updateMember(db, clerk, ids.Alpha, { nextOfKinName: "Kin Alpha Two" });
    const head = await userWith(db, ["MINISTRY_HEAD"], { ministryLabels: ["Youth"] });
    const forHead = (await getMemberProfile(db, head, ids.Alpha))!;
    expect(forHead.events.some((e) => e.type === "DISCIPLINE")).toBe(false);
    expect(forHead.audit).toEqual([]); // no audit:read
    const pastor = await userWith(db, ["PASTOR"]);
    const forPastor = (await getMemberProfile(db, pastor, ids.Alpha))!;
    expect(forPastor.events.some((e) => e.type === "DISCIPLINE")).toBe(true);
    expect(forPastor.audit.find((a) => a.field === "nextOfKinName")?.newValue).toBe("Kin Alpha Two");
    // Out-of-scope member looks like "not found".
    const choirHead = await userWith(db, ["MINISTRY_HEAD"], { ministryLabels: ["Pathfinders"] });
    expect(await getMemberProfile(db, choirHead, ids.Alpha)).toBeNull();
  });
});
