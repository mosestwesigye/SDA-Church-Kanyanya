import { z } from "zod";
import type { HouseholdKind, HouseholdRelation, Prisma } from "@/generated/prisma/client";
import { AuditWriter } from "../audit/audit";
import { assertCan, can, memberScopeWhere, type AuthContext } from "../authz/policy";
import type { Db, DbOrTx } from "../db";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { actorFrom } from "../members/service";
import { KINDS, RELATIONS_BY_KIND, relationLabel } from "@/lib/households";

export { KINDS, RELATIONS_BY_KIND, RELATION_LABELS, relationLabel } from "@/lib/households";


const LIVE: Prisma.MemberWhereInput = { deletedAt: null, mergedIntoId: null, purgedAt: null };

/** Households are family data: viewing needs household:read and sensitive-field access. */
function assertRead(ctx: AuthContext) {
  assertCan(ctx, "household", "read");
  if (!can(ctx, "member.sensitive", "read")) throw new ForbiddenError();
}

async function scopedMember(db: DbOrTx, ctx: AuthContext, id: string) {
  const m = await db.member.findFirst({ where: { AND: [memberScopeWhere(ctx) as Prisma.MemberWhereInput, LIVE, { id }] }, select: { id: true, memberId: true, lastName: true, firstName: true, maritalStatus: true, spouseMemberId: true } });
  if (!m) throw new NotFoundError("Member not found.");
  return m;
}

export async function listHouseholds(db: DbOrTx, ctx: AuthContext, kind: HouseholdKind, q = "", take = 60) {
  assertRead(ctx);
  const tokens = q.trim().split(/\s+/).filter(Boolean);
  const where: Prisma.HouseholdWhereInput = {
    kind,
    AND: tokens.map((t) => ({
      OR: [
        { name: { contains: t, mode: "insensitive" as const } },
        { members: { some: { member: { OR: [{ lastName: { contains: t, mode: "insensitive" as const } }, { firstName: { contains: t, mode: "insensitive" as const } }, { memberId: { contains: t, mode: "insensitive" as const } }] } } } },
      ],
    })),
  };
  const [total, rows] = await Promise.all([
    db.household.count({ where }),
    db.household.findMany({
      where,
      take,
      orderBy: { name: "asc" },
      include: { members: { where: { member: LIVE }, include: { member: { select: { id: true, memberId: true, lastName: true, firstName: true, gender: true } } } } },
    }),
  ]);
  const order = RELATIONS_BY_KIND.FAMILY;
  for (const h of rows) h.members.sort((a, b) => order.indexOf(a.relation) - order.indexOf(b.relation) || a.member.firstName.localeCompare(b.member.firstName));
  return { total, rows };
}

export async function getHousehold(db: DbOrTx, ctx: AuthContext, id: string) {
  assertRead(ctx);
  const h = await db.household.findUnique({
    where: { id },
    include: {
      members: {
        where: { member: LIVE },
        include: { member: { select: { id: true, memberId: true, lastName: true, firstName: true, gender: true, dobPrecision: true, dobDate: true, dobYear: true, status: true, maritalStatus: true, spouseMemberId: true, nextOfKinName: true, nextOfKinPhoneRaw: true } } },
      },
    },
  });
  if (!h) throw new NotFoundError("Family or cell not found.");
  const order: HouseholdRelation[] = ["HEAD", "SPOUSE", "CHILD", "DEPENDANT", "OTHER"];
  h.members.sort((a, b) => order.indexOf(a.relation) - order.indexOf(b.relation) || a.member.lastName.localeCompare(b.member.lastName));
  return h;
}

export async function householdsOfMember(db: DbOrTx, ctx: AuthContext, memberId: string) {
  if (!can(ctx, "household", "read") || !can(ctx, "member.sensitive", "read")) return [];
  return db.householdMember.findMany({
    where: { memberId },
    include: { household: { include: { members: { where: { member: LIVE }, include: { member: { select: { id: true, memberId: true, lastName: true, firstName: true } } } } } } },
  });
}

const kindSchema = z.enum(["FAMILY", "CELL"]).default("FAMILY");
const createInput = z.object({
  kind: kindSchema,
  name: z.string().trim().min(2, "Enter a name").max(80),
  headMemberId: z.string().min(1).optional(),
});

/** A member belongs to at most one family and at most one cell. */
async function assertNotInAnother(db: DbOrTx, kind: HouseholdKind, member: { id: string; firstName: string; lastName: string }, exceptId?: string) {
  const other = await db.householdMember.findFirst({ where: { memberId: member.id, household: { kind, ...(exceptId ? { id: { not: exceptId } } : {}) } }, include: { household: true } });
  if (other) throw new ValidationError(`${member.firstName} ${member.lastName} is already in ${other.household.name}. Remove them there first.`);
}

export async function createHousehold(db: Db, ctx: AuthContext, input: z.input<typeof createInput>) {
  assertCan(ctx, "household", "update");
  assertRead(ctx);
  const v = createInput.parse(input);
  // A family or cell can start without a leader; one can be added later.
  const head = v.headMemberId ? await scopedMember(db, ctx, v.headMemberId) : null;
  if (await db.household.findFirst({ where: { kind: v.kind, name: { equals: v.name, mode: "insensitive" } } })) {
    throw new ValidationError(`A ${KINDS[v.kind].one} called “${v.name}” already exists.`, { name: "Already exists" });
  }
  if (head) await assertNotInAnother(db, v.kind, head);
  return db.$transaction(async (tx) => {
    const h = await tx.household.create({ data: { kind: v.kind, name: v.name, ...(head ? { members: { create: { memberId: head.id, relation: "HEAD" } } } : {}) } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "CREATE", entity: "Household", entityId: h.id, memberId: head?.id ?? null, newValue: { kind: v.kind, name: h.name, ...(head ? { relation: "HEAD" } : {}) } });
    return h;
  });
}

export async function renameHousehold(db: Db, ctx: AuthContext, id: string, nameInput: string) {
  assertCan(ctx, "household", "update");
  const h = await getHousehold(db, ctx, id);
  const name = z.string().trim().min(2, "Enter a name").max(80).parse(nameInput);
  if (name === h.name) return h;
  if (await db.household.findFirst({ where: { kind: h.kind, id: { not: id }, name: { equals: name, mode: "insensitive" } } })) {
    throw new ValidationError(`A ${KINDS[h.kind].one} called “${name}” already exists.`);
  }
  return db.$transaction(async (tx) => {
    const updated = await tx.household.update({ where: { id }, data: { name } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "UPDATE", entity: "Household", entityId: id, field: "name", oldValue: h.name, newValue: name });
    return updated;
  });
}

/** Families and cells to choose from in the member form. */
export async function householdOptions(db: DbOrTx, ctx: AuthContext) {
  assertRead(ctx);
  const rows = await db.household.findMany({
    orderBy: { name: "asc" },
    select: { id: true, kind: true, name: true, members: { where: { member: LIVE }, select: { relation: true } } },
  });
  return rows.map((h) => ({ id: h.id, kind: h.kind, label: h.name, size: h.members.length, hasHead: h.members.some((m) => m.relation === "HEAD") }));
}

export const joinInput = z.object({
  householdId: z.string().optional(),
  kind: kindSchema,
  newName: z.string().trim().max(80).optional(),
  relation: z.enum(["HEAD", "SPOUSE", "CHILD", "DEPENDANT", "OTHER"]),
});

/** Put a member in an existing family/cell, or start a new one with them in it (used by the member form). */
export async function joinHousehold(db: Db, ctx: AuthContext, memberId: string, input: z.input<typeof joinInput>) {
  const v = joinInput.parse(input);
  if (v.newName) {
    if (v.relation === "HEAD") return createHousehold(db, ctx, { kind: v.kind, name: v.newName, headMemberId: memberId });
    const h = await createHousehold(db, ctx, { kind: v.kind, name: v.newName });
    await addToHousehold(db, ctx, { householdId: h.id, memberId, relation: v.relation });
    return h;
  }
  if (!v.householdId) throw new ValidationError("Choose a family or cell.");
  await addToHousehold(db, ctx, { householdId: v.householdId, memberId, relation: v.relation });
  return { id: v.householdId };
}

const addInput = z.object({
  householdId: z.string(),
  memberId: z.string(),
  relation: z.enum(["HEAD", "SPOUSE", "CHILD", "DEPENDANT", "OTHER"]),
});

/** Add a member to a family or cell. */
export async function addToHousehold(db: Db, ctx: AuthContext, input: z.input<typeof addInput>) {
  assertCan(ctx, "household", "update");
  assertRead(ctx);
  const v = addInput.parse(input);
  const m = await scopedMember(db, ctx, v.memberId);
  const h = await getHousehold(db, ctx, v.householdId);
  if (h.members.some((x) => x.memberId === m.id)) throw new ValidationError(`Already in this ${KINDS[h.kind].one}.`);
  if (!RELATIONS_BY_KIND[h.kind].includes(v.relation)) throw new ValidationError(`That role isn’t used in a ${KINDS[h.kind].one}.`);
  if (v.relation === "HEAD" && h.members.some((x) => x.relation === "HEAD")) throw new ValidationError(`This ${KINDS[h.kind].one} already has a ${relationLabel(h.kind, "HEAD").toLowerCase()}.`);
  await assertNotInAnother(db, h.kind, m, h.id);
  await db.$transaction(async (tx) => {
    await tx.householdMember.create({ data: { householdId: h.id, memberId: m.id, relation: v.relation } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "CREATE", entity: "Household", entityId: h.id, memberId: m.id, field: "household", newValue: `${h.name} · ${relationLabel(h.kind, v.relation)}` });
  });

}

export async function setHouseholdRelation(db: Db, ctx: AuthContext, householdId: string, memberId: string, relation: HouseholdRelation) {
  assertCan(ctx, "household", "update");
  const h = await getHousehold(db, ctx, householdId);
  const row = h.members.find((x) => x.memberId === memberId);
  if (!row) throw new NotFoundError();
  if (!RELATIONS_BY_KIND[h.kind].includes(relation)) throw new ValidationError(`That role isn’t used in a ${KINDS[h.kind].one}.`);
  if (relation === "HEAD" && h.members.some((x) => x.relation === "HEAD" && x.memberId !== memberId)) throw new ValidationError(`This ${KINDS[h.kind].one} already has a ${relationLabel(h.kind, "HEAD").toLowerCase()}.`);
  await db.$transaction(async (tx) => {
    await tx.householdMember.update({ where: { householdId_memberId: { householdId, memberId } }, data: { relation } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "UPDATE", entity: "Household", entityId: h.id, memberId, field: "household", oldValue: `${h.name} · ${relationLabel(h.kind, row.relation)}`, newValue: `${h.name} · ${relationLabel(h.kind, relation)}` });
  });
}

export async function removeFromHousehold(db: Db, ctx: AuthContext, householdId: string, memberId: string) {
  assertCan(ctx, "household", "update");
  const h = await getHousehold(db, ctx, householdId);
  const row = h.members.find((x) => x.memberId === memberId);
  if (!row) throw new NotFoundError();
  await db.$transaction(async (tx) => {
    await tx.householdMember.delete({ where: { householdId_memberId: { householdId, memberId } } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "DELETE", entity: "Household", entityId: h.id, memberId, field: "household", oldValue: `${h.name} · ${relationLabel(h.kind, row.relation)}` });
    if (h.members.length === 1) await tx.household.delete({ where: { id: h.id } });
  });
}
