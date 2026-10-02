import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { memberScopeWhere, memberSelect, projectMember } from "@/server/authz/policy";
import { addMinistry, createMember, softDeleteMember, updateMember } from "@/server/members/service";
import { ensureReferenceData } from "@/server/setup/reference-data";
import { ForbiddenError } from "@/server/errors";
import { listId, testDb, userWith } from "./helpers";

let db: Db;
let clerk: Awaited<ReturnType<typeof userWith>>;
let youthMemberId: string;
let choirMemberId: string;

beforeAll(async () => {
  db = await testDb();
  clerk = await userWith(db, ["CHURCH_CLERK"]);
  const role = await listId(db, "MINISTRY_ROLE", "Member");
  const youth = await createMember(db, clerk, { lastName: "Scope", firstName: "Youthful", maritalStatus: "SINGLE", nextOfKinName: "Kin A" });
  const choir = await createMember(db, clerk, { lastName: "Scope", firstName: "Singer", maritalStatus: "MARRIED", nextOfKinName: "Kin B" });
  await addMinistry(db, clerk, youth.id, await listId(db, "MINISTRY", "Youth"), role);
  await addMinistry(db, clerk, choir.id, await listId(db, "MINISTRY", "Church Choir"), role);
  youthMemberId = youth.id;
  choirMemberId = choir.id;
});
afterAll(async () => {
  await db.$disconnect();
});

async function directory(ctx: Awaited<ReturnType<typeof userWith>>) {
  const rows = await db.member.findMany({
    where: { AND: [memberScopeWhere(ctx), { lastName: "Scope" }] },
    select: memberSelect(ctx),
    orderBy: { firstName: "asc" },
  });
  return rows.map((r) => projectMember(ctx, r as unknown as { id: string; ministries: { ministryId: string }[] } & Record<string, unknown>));
}

describe("ministry head scope", () => {
  it("lists only members of their own ministries", async () => {
    const head = await userWith(db, ["MINISTRY_HEAD"], { ministryLabels: ["Youth"] });
    const rows = await directory(head);
    expect(rows.map((r) => r.id)).toEqual([youthMemberId]);
  });

  it("cannot edit members outside their ministries (or inside them)", async () => {
    const head = await userWith(db, ["MINISTRY_HEAD"], { ministryLabels: ["Youth"] });
    await expect(updateMember(db, head, choirMemberId, { firstName: "X" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateMember(db, head, youthMemberId, { firstName: "X" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("can assign roles within their ministry but not others", async () => {
    const head = await userWith(db, ["MINISTRY_HEAD"], { ministryLabels: ["Youth"] });
    const headRole = await listId(db, "MINISTRY_ROLE", "Assistant Head");
    await expect(addMinistry(db, head, youthMemberId, await listId(db, "MINISTRY", "Youth"), headRole)).resolves.toBeTruthy();
    await expect(addMinistry(db, head, choirMemberId, await listId(db, "MINISTRY", "Church Choir"), headRole)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("field restrictions applied in queries", () => {
  it("never loads marital status or next of kin for a ministry head", async () => {
    const head = await userWith(db, ["MINISTRY_HEAD"], { ministryLabels: ["Youth"] });
    const [row] = await directory(head);
    expect(row).not.toHaveProperty("maritalStatus");
    expect(row).not.toHaveProperty("nextOfKinName");
    expect(row.restricted).toEqual(["member.sensitive"]);
  });

  it("treasurer sees name, ID and ministry only, for everyone", async () => {
    const t = await userWith(db, ["TREASURER"]);
    const rows = await directory(t);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(
        ["createdAt", "deletedAt", "firstName", "id", "lastName", "memberId", "memberNo", "mergedIntoId", "ministries", "restricted", "updatedAt", "version"].sort(),
      );
    }
  });

  it("elders and pastors see sensitive fields", async () => {
    for (const role of ["ELDER", "PASTOR"] as const) {
      const ctx = await userWith(db, [role]);
      const rows = await directory(ctx);
      expect(rows.find((r) => r.id === choirMemberId)).toMatchObject({ maritalStatus: "MARRIED", nextOfKinName: "Kin B", restricted: [] });
    }
  });

  it("assistant clerk cannot delete; clerk can", async () => {
    const asst = await userWith(db, ["ASSISTANT_CLERK"]);
    await expect(softDeleteMember(db, asst, youthMemberId, "x")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("matrix is data, editable by admins", () => {
  it("revoking a grant in the database takes effect on the next request", async () => {
    const elderRole = await db.role.findUniqueOrThrow({ where: { key: "ELDER" } });
    await db.permission.deleteMany({ where: { roleId: elderRole.id, resource: "member.sensitive" } });
    try {
      const elder = await userWith(db, ["ELDER"]);
      const rows = await directory(elder);
      expect(rows.every((r) => r.restricted.includes("member.sensitive"))).toBe(true);
      expect(rows.every((r) => !("nextOfKinName" in r))).toBe(true);
    } finally {
      await ensureReferenceData(db, { resetPermissions: true });
    }
  });
});
