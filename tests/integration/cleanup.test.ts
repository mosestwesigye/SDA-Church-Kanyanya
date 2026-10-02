import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { mapRawValues, resolveFlag } from "@/server/cleanup/mapping";
import { dismissDuplicate, mergeMembers, undoMerge } from "@/server/cleanup/merge";
import { cleanupProgress, duplicatePairs, flaggedQueue, incompleteQueue, invalidPhoneQueue, nonStandardGroups } from "@/server/cleanup/queues";
import { loadLookups } from "@/server/import/register-import";
import { normalizeRow } from "@/server/import/normalize-row";
import { addMinistry, createMember, flagForReview, updateMember } from "@/server/members/service";
import { uploadDocument } from "@/server/members/documents";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { listId, testDb, userWith } from "./helpers";

let db: Db;
let clerk: Awaited<ReturnType<typeof userWith>>;
const T = `Cln${Date.now().toString(36)}`;

beforeAll(async () => {
  db = await testDb();
  clerk = await userWith(db, ["CHURCH_CLERK"]);
});
afterAll(async () => {
  await db.$disconnect();
});

async function pairOf(lastName: string, a: Record<string, unknown>, b: Record<string, unknown>) {
  const m1 = await createMember(db, clerk, { lastName, firstName: "John", ...a } as never);
  const m2 = await createMember(db, clerk, { lastName, firstName: "John B.", ...b } as never);
  return [m1, m2] as const;
}

describe("suspected duplicates", () => {
  it("pairs similar names and same phones, and respects 'not a duplicate'", async () => {
    const [a, b] = await pairOf(`${T}Ssekandi`, { phone: "0774 901 335" }, { phone: "0774901335" });
    const pairs = await duplicatePairs(db, clerk);
    const p = pairs.find((x) => [x.a, x.b].sort().join() === [a.id, b.id].sort().join());
    expect(p?.samePhone).toBe(true);
    expect(p?.reasons).toContain("Same phone");
    await dismissDuplicate(db, clerk, b.id, a.id);
    expect((await duplicatePairs(db, clerk)).some((x) => [x.a, x.b].includes(a.id) && [x.a, x.b].includes(b.id))).toBe(false);
  });

  it("queues need cleanup:use", async () => {
    const elder = await userWith(db, ["ELDER"]);
    await expect(duplicatePairs(db, elder)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(incompleteQueue(db, elder, {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("merge", () => {
  it("keeps chosen values, moves linked rows, retires the other ID and audits", async () => {
    const zone = await listId(db, "ZONE", "Kanyanya");
    const [keep, gone] = await pairOf(`${T}Merge`, { phone: "0774 901 100", zoneId: zone }, { phone: "0774 901 101", dobPrecision: "YEAR", dobYear: 1983, yearJoined: 2009 });
    const role = await listId(db, "MINISTRY_ROLE", "Member");
    await addMinistry(db, clerk, keep.id, await listId(db, "MINISTRY", "Deaconry"), role);
    await addMinistry(db, clerk, gone.id, await listId(db, "MINISTRY", "Deaconry"), role); // duplicate link → dropped
    await addMinistry(db, clerk, gone.id, await listId(db, "MINISTRY", "Youth"), role); // moved
    const doc = await uploadDocument(db, clerk, gone.id, "OTHER", { data: Buffer.from("%PDF-1.4 x"), name: "x.pdf" });
    const spouse = await createMember(db, clerk, { lastName: `${T}Merge`, firstName: "Wife", maritalStatus: "MARRIED", spouseMemberId: gone.id });

    const asst = await userWith(db, ["ASSISTANT_CLERK"]);
    await expect(mergeMembers(db, asst, { survivorId: keep.id, retiredId: gone.id })).rejects.toBeInstanceOf(ForbiddenError);

    const merge = await mergeMembers(db, clerk, { survivorId: keep.id, retiredId: gone.id, choices: { dob: "retired", yearJoined: "retired", phone: "survivor" } });
    const s = await db.member.findUniqueOrThrow({ where: { id: keep.id }, include: { ministries: { include: { ministry: true } } } });
    const r = await db.member.findUniqueOrThrow({ where: { id: gone.id } });
    expect(s).toMatchObject({ dobYear: 1983, yearJoined: 2009, phoneE164: "+256774901100", zoneId: zone });
    expect(s.ministries.map((l) => l.ministry.label).sort()).toEqual(["Deaconry", "Youth"]);
    expect(r.mergedIntoId).toBe(keep.id);
    expect((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).memberId).toBe(keep.id);
    expect((await db.member.findUniqueOrThrow({ where: { id: spouse.id } })).spouseMemberId).toBe(keep.id);
    expect(await db.membershipEvent.count({ where: { memberId: keep.id, type: "MERGE" } })).toBe(1);
    const audits = await db.auditLog.findMany({ where: { correlationId: { not: null }, source: "MERGE", memberId: { in: [keep.id, gone.id] } } });
    expect(audits.some((a) => a.action === "MERGE" && a.memberId === gone.id)).toBe(true);
    expect(audits.some((a) => a.field === "dobYear" && a.newValue === 1983)).toBe(true);
    // The retired ID can't be merged again or reused.
    await expect(mergeMembers(db, clerk, { survivorId: keep.id, retiredId: gone.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(db.member.create({ data: { memberNo: r.memberNo, lastName: "X", firstName: "Y" } })).rejects.toThrow();
    expect(merge.undoableUntil.getTime()).toBeGreaterThan(Date.now() + 29 * 86400_000);
  });

  it("undo restores both records, keeps later edits and re-activates the ID", async () => {
    const [keep, gone] = await pairOf(`${T}Undo`, {}, { gender: "MALE", dobPrecision: "YEAR", dobYear: 1970 });
    await addMinistry(db, clerk, gone.id, await listId(db, "MINISTRY", "Music"), await listId(db, "MINISTRY_ROLE", "Member"));
    const merge = await mergeMembers(db, clerk, { survivorId: keep.id, retiredId: gone.id, choices: { gender: "retired", dob: "retired" } });
    // A later edit to a merged field must survive the undo.
    await updateMember(db, clerk, keep.id, { gender: "FEMALE" });

    const { keptLaterEdits } = await undoMerge(db, clerk, merge.id);
    expect(keptLaterEdits).toEqual(["gender"]);
    const s = await db.member.findUniqueOrThrow({ where: { id: keep.id }, include: { ministries: true } });
    const r = await db.member.findUniqueOrThrow({ where: { id: gone.id }, include: { ministries: true } });
    expect(s.gender).toBe("FEMALE");
    expect(s.dobPrecision).toBe("UNKNOWN");
    expect(s.ministries).toHaveLength(0);
    expect(r.mergedIntoId).toBeNull();
    expect(r.ministries).toHaveLength(1);
    expect(await db.auditLog.count({ where: { memberId: gone.id, action: "UNMERGE" } })).toBe(1);
    await expect(undoMerge(db, clerk, merge.id)).rejects.toThrow(/already undone/);
  });

  it("can't undo after the window", async () => {
    const [keep, gone] = await pairOf(`${T}Late`, {}, {});
    const merge = await mergeMembers(db, clerk, { survivorId: keep.id, retiredId: gone.id });
    await db.merge.update({ where: { id: merge.id }, data: { undoableUntil: new Date(Date.now() - 1000) } });
    await expect(undoMerge(db, clerk, merge.id)).rejects.toThrow(/window/);
  });
});

describe("non-standard values", () => {
  async function withRaw(field: "ZONE" | "MINISTRY" | "MINISTRY_ROLE" | "PROFESSION" | "GENDER", rawValue: string, fields: Record<string, unknown> = {}) {
    const m = await createMember(db, clerk, { lastName: `${T}Raw`, firstName: rawValue, ...fields } as never);
    await db.rawValue.create({ data: { memberId: m.id, field, rawValue, normalized: rawValue.toLowerCase().replace(/[^a-z0-9]/g, "") } });
    return m;
  }

  it("maps a group to a list value, fills only empty fields, remembers it for imports", async () => {
    const empty = await withRaw("ZONE", "Lower Konge");
    const filled = await withRaw("ZONE", "Lower Konge ", { zoneId: await listId(db, "ZONE", "Mpererwe") });
    const groups = await nonStandardGroups(db, clerk);
    expect(groups.some((g) => g.field === "ZONE" && g.values.some((v) => v.normalized === "lowerkonge"))).toBe(true);

    const r = await mapRawValues(db, clerk, { field: "ZONE", normalized: ["lowerkonge"], target: { kind: "item", id: await listId(db, "ZONE", "Kanyanya") } });
    expect(r.resolved).toBe(2);
    expect(r.applied).toBe(1);
    expect((await db.member.findUniqueOrThrow({ where: { id: empty.id } })).zoneId).toBe(await listId(db, "ZONE", "Kanyanya"));
    expect((await db.member.findUniqueOrThrow({ where: { id: filled.id } })).zoneId).toBe(await listId(db, "ZONE", "Mpererwe"));
    expect(await db.auditLog.count({ where: { memberId: empty.id, field: "zoneId" } })).toBe(1);

    // The next import maps "Lower Konge" automatically.
    const n = normalizeRow({ memberId: "SDAK/M9990", lastName: "A", firstName: "B", zone: "Lower Konge" }, await loadLookups(db));
    expect(n.columns.zoneId).toBe(await listId(db, "ZONE", "Kanyanya"));
    expect(n.rawValues).toEqual([]);
  });

  it("ministry values add a link; role values set the role on the only link", async () => {
    const m = await withRaw("MINISTRY", "Stewardship");
    await mapRawValues(db, clerk, { field: "MINISTRY", normalized: ["stewardship"], target: { kind: "item", id: await listId(db, "MINISTRY", "Development") } });
    const links = await db.memberMinistry.findMany({ where: { memberId: m.id }, include: { role: true } });
    expect(links).toHaveLength(1);
    await db.rawValue.create({ data: { memberId: m.id, field: "MINISTRY_ROLE", rawValue: "Leader", normalized: "leader" } });
    await mapRawValues(db, clerk, { field: "MINISTRY_ROLE", normalized: ["leader"], target: { kind: "item", id: await listId(db, "MINISTRY_ROLE", "Head") } });
    expect((await db.memberMinistry.findFirstOrThrow({ where: { memberId: m.id }, include: { role: true } })).role.label).toBe("Head");
  });

  it("blank resolves without changing the record; new list values need an admin", async () => {
    const m = await withRaw("PROFESSION", "Muyilibi");
    await expect(mapRawValues(db, clerk, { field: "PROFESSION", normalized: ["muyilibi"], target: { kind: "new", label: "Writer" } })).rejects.toBeInstanceOf(ForbiddenError);
    await mapRawValues(db, clerk, { field: "PROFESSION", normalized: ["muyilibi"], target: { kind: "blank" }, remember: false });
    expect(await db.rawValue.count({ where: { memberId: m.id, resolvedAt: null } })).toBe(0);
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).professionId).toBeNull();
    const admin = await userWith(db, ["SYSTEM_ADMIN"]);
    const m2 = await withRaw("PROFESSION", "Compound Designer");
    await mapRawValues(db, admin, { field: "PROFESSION", normalized: ["compounddesigner"], target: { kind: "new", label: "Landscaper" } });
    const item = await db.listItem.findFirstOrThrow({ where: { type: "PROFESSION", label: "Landscaper" } });
    expect((await db.member.findUniqueOrThrow({ where: { id: m2.id } })).professionId).toBe(item.id);
  });

  it("non-list fields can only be cleared", async () => {
    await withRaw("GENDER", "Femal");
    await expect(mapRawValues(db, clerk, { field: "GENDER", normalized: ["femal"], target: { kind: "item", id: "x" } })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("other queues and progress", () => {
  it("incomplete queue filters by missing field and status; invalid phones; flags", async () => {
    const m = await createMember(db, clerk, { lastName: `${T}Queue`, firstName: "Phone", phone: null, status: "IRREGULAR" });
    await db.member.update({ where: { id: m.id }, data: { phoneRaw: "0772 45 678" } });
    const q = await incompleteQueue(db, clerk, { missing: "phone", status: "IRREGULAR", take: 500 });
    expect(q.rows.map((r) => r.id)).toContain(m.id);
    expect(q.rows.every((r) => r.missingFields.includes("phone"))).toBe(true);
    expect((await invalidPhoneQueue(db, clerk, 500)).rows.map((r) => r.id)).toContain(m.id);
    await flagForReview(db, clerk, [m.id], "Call to confirm");
    const flag = (await flaggedQueue(db, clerk)).find((f) => f.memberId === m.id)!;
    await resolveFlag(db, clerk, flag.id);
    expect((await flaggedQueue(db, clerk)).some((f) => f.memberId === m.id)).toBe(false);
  });

  it("progress counts complete members and this week's fixers", async () => {
    const p = await cleanupProgress(db);
    expect(p.total).toBeGreaterThan(0);
    expect(p.targetPercent).toBe(60);
    expect(p.topFixers.some((f) => f.name === clerk.label)).toBe(true);
  });
});
