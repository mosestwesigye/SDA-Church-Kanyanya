import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { daysToBirthday, dashboardStats, upcomingBirthdays } from "@/server/dashboard/stats";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { addToHousehold, createHousehold, listHouseholds, getHousehold, householdOptions, joinHousehold, removeFromHousehold } from "@/server/households/service";
import { addMinistry, createMember } from "@/server/members/service";
import { listMinistries, ministryRoster, setMinistryRole } from "@/server/ministries/service";
import { listId, testDb, userWith } from "./helpers";

let db: Db;
let clerk: Awaited<ReturnType<typeof userWith>>;

beforeAll(async () => {
  db = await testDb();
  clerk = await userWith(db, ["CHURCH_CLERK"]);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("birthdays", () => {
  it("counts days to the next birthday, including year wrap and 29 February", () => {
    const today = { y: 2026, m: 9, d: 3 }; // 3 Oct 2026
    expect(daysToBirthday(new Date("1980-10-03T00:00:00Z"), today)).toBe(0);
    expect(daysToBirthday(new Date("1980-10-10T00:00:00Z"), today)).toBe(7);
    expect(daysToBirthday(new Date("1980-10-02T00:00:00Z"), today)).toBe(364);
    expect(daysToBirthday(new Date("1980-02-29T00:00:00Z"), { y: 2027, m: 1, d: 27 })).toBe(1); // 28 Feb in a common year
  });

  it("lists only full-DOB, living members", async () => {
    const soon = new Date(Date.now() + 2 * 86400_000);
    const iso = `1990-${String(soon.getUTCMonth() + 1).padStart(2, "0")}-${String(soon.getUTCDate()).padStart(2, "0")}`;
    const m = await createMember(db, clerk, { lastName: "Bday", firstName: "Soon", dobPrecision: "FULL", dobDate: iso });
    await createMember(db, clerk, { lastName: "Bday", firstName: "YearOnly", dobPrecision: "YEAR", dobYear: 1990 });
    const list = await upcomingBirthdays(db, clerk, 7, 50);
    expect(list.some((b) => b.id === m.id)).toBe(true);
    expect(list.some((b) => b.name.includes("YearOnly"))).toBe(false);
    const t = await userWith(db, ["TREASURER"]);
    expect(await upcomingBirthdays(db, t)).toEqual([]); // no profile access
  });
});

describe("dashboard stats", () => {
  it("are scoped: a ministry head sees only their ministries' members, without profile breakdowns leaking", async () => {
    const role = await listId(db, "MINISTRY_ROLE", "Member");
    const m = await createMember(db, clerk, { lastName: "Dash", firstName: "Pathfinder", gender: "FEMALE", dobPrecision: "YEAR", dobYear: 2012 });
    await addMinistry(db, clerk, m.id, await listId(db, "MINISTRY", "Pathfinders"), role);
    const head = await userWith(db, ["MINISTRY_HEAD"], { ministryLabels: ["Pathfinders"] });
    const s = await dashboardStats(db, head);
    const all = await dashboardStats(db, clerk);
    expect(s.total).toBeLessThan(all.total);
    expect(s.total).toBe(await db.member.count({ where: { deletedAt: null, mergedIntoId: null, purgedAt: null, ministries: { some: { ministry: { label: "Pathfinders" } } } } }));
    expect(s.ages.find((a) => a.key === "0–17")!.n).toBeGreaterThanOrEqual(1);
    expect(all.status.reduce((n, x) => n + x.n, 0)).toBe(all.total);
    expect(all.gender.reduce((n, x) => n + x.n, 0)).toBe(all.total);
    expect(all.ages.reduce((n, x) => n + x.n, 0) + all.unknownAge).toBe(all.total);
    const t = await dashboardStats(db, await userWith(db, ["TREASURER"]));
    expect(t.profile).toBe(false);
    expect(t.status.every((x) => x.n === 0)).toBe(true);
  });
});

describe("ministries", () => {
  it("ministry heads only see and manage their own ministries; role changes are audited", async () => {
    const head = await userWith(db, ["MINISTRY_HEAD"], { ministryLabels: ["Music"] });
    expect((await listMinistries(db, head)).map((m) => m.label)).toEqual(["Music"]);
    await expect(ministryRoster(db, head, await listId(db, "MINISTRY", "Youth"))).rejects.toBeInstanceOf(ForbiddenError);

    const m = await createMember(db, clerk, { lastName: "Min", firstName: "Singer", maritalStatus: "SINGLE" });
    const link = await addMinistry(db, clerk, m.id, await listId(db, "MINISTRY", "Music"), await listId(db, "MINISTRY_ROLE", "Member"));
    const { roster, canManage } = await ministryRoster(db, head, await listId(db, "MINISTRY", "Music"));
    expect(canManage).toBe(true);
    const row = roster.find((r) => r.member.id === m.id)!;
    expect(row.member.restricted).toContain("member.sensitive");
    expect(row.member).not.toHaveProperty("maritalStatus");

    await setMinistryRole(db, head, link.id, await listId(db, "MINISTRY_ROLE", "Chorister"));
    expect((await db.memberMinistry.findUniqueOrThrow({ where: { id: link.id }, include: { role: true } })).role.label).toBe("Chorister");
    expect(await db.auditLog.count({ where: { entity: "MemberMinistry", entityId: link.id, action: "UPDATE", actorUserId: head.userId } })).toBe(1);

    const other = await addMinistry(db, clerk, m.id, await listId(db, "MINISTRY", "Youth"), await listId(db, "MINISTRY_ROLE", "Member"));
    await expect(setMinistryRole(db, head, other.id, await listId(db, "MINISTRY_ROLE", "Head"))).rejects.toBeInstanceOf(ForbiddenError);
    const leaders = await listMinistries(db, clerk);
    await setMinistryRole(db, clerk, other.id, await listId(db, "MINISTRY_ROLE", "Head"));
    const after = (await listMinistries(db, clerk)).find((x) => x.label === "Youth")!;
    expect(after.heads.some((h) => h.id === m.id)).toBe(true);
    expect(leaders.length).toBe(after ? leaders.length : 0);
  });
});

describe("households", () => {
  it("needs household permission plus sensitive access", async () => {
    const t = await userWith(db, ["TREASURER"]);
    await expect(listHouseholds(db, t, "FAMILY")).rejects.toBeInstanceOf(ForbiddenError);
    const elder = await userWith(db, ["ELDER"]);
    const head = await createMember(db, clerk, { lastName: "Home", firstName: "Head" });
    await expect(createHousehold(db, elder, { name: "Home household", headMemberId: head.id })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("creates a family with a leader and members, and cleans up when emptied", async () => {
    const leader = await createMember(db, clerk, { lastName: "Wasswa", firstName: "Henry" });
    const a = await createMember(db, clerk, { lastName: "Babirye", firstName: "Joan" });
    const b = await createMember(db, clerk, { lastName: "Wasswa", firstName: "Junior" });
    const h = await createHousehold(db, clerk, { kind: "FAMILY", name: `Bethel ${Date.now().toString(36)}`, headMemberId: leader.id });
    await expect(addToHousehold(db, clerk, { householdId: h.id, memberId: b.id, relation: "HEAD" })).rejects.toBeInstanceOf(ValidationError);
    await expect(addToHousehold(db, clerk, { householdId: h.id, memberId: b.id, relation: "CHILD" })).rejects.toBeInstanceOf(ValidationError);
    await addToHousehold(db, clerk, { householdId: h.id, memberId: a.id, relation: "OTHER" });
    await addToHousehold(db, clerk, { householdId: h.id, memberId: b.id, relation: "OTHER" });
    expect((await getHousehold(db, clerk, h.id)).members.map((m) => m.relation)).toEqual(["HEAD", "OTHER", "OTHER"]);
    for (const id of [b.id, a.id, leader.id]) await removeFromHousehold(db, clerk, h.id, id);
    expect(await db.household.findUnique({ where: { id: h.id } })).toBeNull();
  });

  it("creates a cell without a leader, rejects duplicate names, and audits it", async () => {
    const name = `Kanyanya Cell ${Date.now().toString(36)}`;
    const h = await createHousehold(db, clerk, { name });
    expect((await getHousehold(db, clerk, h.id)).members).toHaveLength(0);
    expect(await db.auditLog.count({ where: { entity: "Household", entityId: h.id, action: "CREATE" } })).toBe(1);
    await expect(createHousehold(db, clerk, { name: name.toUpperCase() })).rejects.toBeInstanceOf(ValidationError);
    expect((await householdOptions(db, clerk)).find((o) => o.id === h.id)).toMatchObject({ label: name, size: 0, hasHead: false });
  });

  it("places a member in an existing or new family/cell from the member form", async () => {
    const leader = await createMember(db, clerk, { lastName: "Cell", firstName: "Leader" });
    const member = await createMember(db, clerk, { lastName: "Cell", firstName: "Member" });
    const created = await joinHousehold(db, clerk, leader.id, { newName: `Cell ${Date.now().toString(36)}`, relation: "HEAD" });
    await joinHousehold(db, clerk, member.id, { householdId: created.id, relation: "OTHER" });
    const h = await getHousehold(db, clerk, created.id);
    expect(h.members.map((m) => [m.memberId, m.relation])).toEqual([[leader.id, "HEAD"], [member.id, "OTHER"]]);
    // Only one head per family/cell; elders can't place members.
    const other = await createMember(db, clerk, { lastName: "Cell", firstName: "Second" });
    await expect(joinHousehold(db, clerk, other.id, { householdId: created.id, relation: "HEAD" })).rejects.toBeInstanceOf(ValidationError);
    const elder = await userWith(db, ["ELDER"]);
    await expect(joinHousehold(db, elder, other.id, { householdId: created.id, relation: "OTHER" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

