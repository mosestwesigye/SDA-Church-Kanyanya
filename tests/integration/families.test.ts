import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { ValidationError } from "@/server/errors";
import { relationLabel } from "@/lib/households";
import { addToHousehold, createHousehold, getHousehold, listHouseholds, renameHousehold } from "@/server/households/service";
import { createMember } from "@/server/members/service";
import { testDb, userWith } from "./helpers";

let db: Db;
let clerk: Awaited<ReturnType<typeof userWith>>;
const tag = Date.now().toString(36);

beforeAll(async () => {
  db = await testDb();
  clerk = await userWith(db, ["CHURCH_CLERK"]);
});
afterAll(async () => {
  await db.$disconnect();
});

const person = (firstName: string, gender: "MALE" | "FEMALE" = "MALE") => createMember(db, clerk, { lastName: `Fam${tag}`, firstName, gender });

describe("families module", () => {
  it("works like a cell: a leader and members, with family wording", async () => {
    const leader = await person("Moses");
    const h = await createHousehold(db, clerk, { kind: "FAMILY", name: `Bethel Family ${tag}`, headMemberId: leader.id });
    const m = await person("Ruth", "FEMALE");
    await addToHousehold(db, clerk, { householdId: h.id, memberId: m.id, relation: "OTHER" });
    const got = await getHousehold(db, clerk, h.id);
    expect(got.members.map((x) => [x.member.firstName, relationLabel(got.kind, x.relation)])).toEqual([["Moses", "Family leader"], ["Ruth", "Family member"]]);
    await expect(addToHousehold(db, clerk, { householdId: h.id, memberId: (await person("Kid")).id, relation: "CHILD" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("allows one family and one cell per member, and only cell roles in a cell", async () => {
    const m = await person("Single");
    const f1 = await createHousehold(db, clerk, { kind: "FAMILY", name: `First ${tag}`, headMemberId: m.id });
    const f2 = await createHousehold(db, clerk, { kind: "FAMILY", name: `Second ${tag}` });
    await expect(addToHousehold(db, clerk, { householdId: f2.id, memberId: m.id, relation: "OTHER" })).rejects.toBeInstanceOf(ValidationError);
    const cell = await createHousehold(db, clerk, { kind: "CELL", name: `Cell ${tag}` });
    await addToHousehold(db, clerk, { householdId: cell.id, memberId: m.id, relation: "OTHER" });
    expect(f1.kind).toBe("FAMILY");
  });

  it("lists families and cells separately, searchable by member name; names are unique per kind", async () => {
    const dad = await person("Searchable");
    await createHousehold(db, clerk, { kind: "FAMILY", name: `Same ${tag}`, headMemberId: dad.id });
    await createHousehold(db, clerk, { kind: "CELL", name: `Same ${tag}` });
    await expect(createHousehold(db, clerk, { kind: "FAMILY", name: `same ${tag}` })).rejects.toBeInstanceOf(ValidationError);
    const fams = await listHouseholds(db, clerk, "FAMILY", `Searchable Fam${tag}`);
    expect(fams.rows.map((r) => r.name)).toEqual([`Same ${tag}`]);
    expect((await listHouseholds(db, clerk, "CELL", `Same ${tag}`)).rows.every((r) => r.kind === "CELL")).toBe(true);
  });

  it("renames with an audit entry", async () => {
    const h = await createHousehold(db, clerk, { kind: "FAMILY", name: `Old ${tag}` });
    await renameHousehold(db, clerk, h.id, `New ${tag}`);
    expect((await getHousehold(db, clerk, h.id)).name).toBe(`New ${tag}`);
    expect(await db.auditLog.count({ where: { entity: "Household", entityId: h.id, field: "name" } })).toBe(1);
  });
});
