import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { ValidationError } from "@/server/errors";
import { suggestFamilyName } from "@/lib/households";
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
  it("creates a family from husband and wife, linking them as spouses", async () => {
    const husband = await person("Moses");
    const wife = await person("Ruth", "FEMALE");
    const name = suggestFamilyName(husband, wife);
    expect(name).toBe(`Mr and Mrs Fam${tag} Moses`);
    const h = await createHousehold(db, clerk, { kind: "FAMILY", name, headMemberId: husband.id, spouseMemberId: wife.id });
    const got = await getHousehold(db, clerk, h.id);
    expect(got.kind).toBe("FAMILY");
    expect(got.members.map((m) => [m.member.firstName, m.relation])).toEqual([["Moses", "HEAD"], ["Ruth", "SPOUSE"]]);
    const [mh, mw] = await Promise.all([db.member.findUniqueOrThrow({ where: { id: husband.id } }), db.member.findUniqueOrThrow({ where: { id: wife.id } })]);
    expect([mh.spouseMemberId, mw.spouseMemberId, mh.maritalStatus]).toEqual([wife.id, husband.id, "MARRIED"]);

    const child = await person("Junior");
    await addToHousehold(db, clerk, { householdId: h.id, memberId: child.id, relation: "CHILD" });
    expect((await getHousehold(db, clerk, h.id)).members).toHaveLength(3);
  });

  it("allows one family and one cell per member, and only cell roles in a cell", async () => {
    const m = await person("Single");
    const f1 = await createHousehold(db, clerk, { kind: "FAMILY", name: `First ${tag}`, headMemberId: m.id });
    const f2 = await createHousehold(db, clerk, { kind: "FAMILY", name: `Second ${tag}` });
    await expect(addToHousehold(db, clerk, { householdId: f2.id, memberId: m.id, relation: "OTHER" })).rejects.toBeInstanceOf(ValidationError);
    const cell = await createHousehold(db, clerk, { kind: "CELL", name: `Cell ${tag}` });
    await addToHousehold(db, clerk, { householdId: cell.id, memberId: m.id, relation: "OTHER" });
    const kid = await person("Kid");
    await expect(addToHousehold(db, clerk, { householdId: cell.id, memberId: kid.id, relation: "CHILD" })).rejects.toBeInstanceOf(ValidationError);
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
