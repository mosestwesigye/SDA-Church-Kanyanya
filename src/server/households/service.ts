import { z } from "zod";
import type { HouseholdRelation, Prisma } from "@/generated/prisma/client";
import { AuditWriter } from "../audit/audit";
import { assertCan, can, memberScopeWhere, type AuthContext } from "../authz/policy";
import type { Db, DbOrTx } from "../db";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { actorFrom, updateMember } from "../members/service";

export const RELATION_LABELS: Record<HouseholdRelation, string> = {
  HEAD: "Head / cell leader",
  SPOUSE: "Spouse",
  CHILD: "Child",
  DEPENDANT: "Dependant",
  OTHER: "Cell member",
};

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

export async function listHouseholds(db: DbOrTx, ctx: AuthContext, q = "", take = 50) {
  assertRead(ctx);
  const text = q.trim();
  const where: Prisma.HouseholdWhereInput = text
    ? { OR: [{ name: { contains: text, mode: "insensitive" } }, { members: { some: { member: { OR: [{ lastName: { contains: text, mode: "insensitive" } }, { firstName: { contains: text, mode: "insensitive" } }] } } } }] }
    : {};
  const [total, rows] = await Promise.all([
    db.household.count({ where }),
    db.household.findMany({
      where,
      take,
      orderBy: { name: "asc" },
      include: { members: { where: { member: LIVE }, include: { member: { select: { id: true, memberId: true, lastName: true, firstName: true } } } } },
    }),
  ]);
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
  if (!h) throw new NotFoundError("Household not found.");
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

const createInput = z.object({ name: z.string().trim().min(2, "Enter a name for the family or cell").max(80), headMemberId: z.string().min(1).optional() });

export async function createHousehold(db: Db, ctx: AuthContext, input: z.input<typeof createInput>) {
  assertCan(ctx, "household", "update");
  assertRead(ctx);
  const v = createInput.parse(input);
  // A cell can start without a leader; one can be added later.
  const head = v.headMemberId ? await scopedMember(db, ctx, v.headMemberId) : null;
  if (await db.household.findFirst({ where: { name: { equals: v.name, mode: "insensitive" } } })) {
    throw new ValidationError(`A family or cell called “${v.name}” already exists.`, { name: "Already exists" });
  }
  return db.$transaction(async (tx) => {
    const h = await tx.household.create({ data: { name: v.name, ...(head ? { members: { create: { memberId: head.id, relation: "HEAD" } } } : {}) } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "CREATE", entity: "Household", entityId: h.id, memberId: head?.id ?? null, newValue: { name: h.name, ...(head ? { relation: "HEAD" } : {}) } });
    return h;
  });
}

/** Families and cells to choose from in the member form. */
export async function householdOptions(db: DbOrTx, ctx: AuthContext) {
  assertRead(ctx);
  const rows = await db.household.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, members: { where: { member: LIVE }, select: { relation: true } } },
  });
  return rows.map((h) => ({ id: h.id, label: h.name, size: h.members.length, hasHead: h.members.some((m) => m.relation === "HEAD") }));
}

export const joinInput = z.object({
  householdId: z.string().optional(),
  newName: z.string().trim().max(80).optional(),
  relation: z.enum(["HEAD", "SPOUSE", "CHILD", "DEPENDANT", "OTHER"]),
});

/** Put a member in an existing family/cell, or start a new one with them in it (used by the member form). */
export async function joinHousehold(db: Db, ctx: AuthContext, memberId: string, input: z.input<typeof joinInput>) {
  const v = joinInput.parse(input);
  if (v.newName) {
    if (v.relation === "HEAD") return createHousehold(db, ctx, { name: v.newName, headMemberId: memberId });
    const h = await createHousehold(db, ctx, { name: v.newName });
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
  linkSpouse: z.boolean().default(false),
});

/**
 * Add a member to a household. With `linkSpouse`, a SPOUSE is also linked to
 * the household head as spouse on both records (through the audited member
 * service, so the Spouse field and audit log stay in step).
 */
export async function addToHousehold(db: Db, ctx: AuthContext, input: z.input<typeof addInput>) {
  assertCan(ctx, "household", "update");
  assertRead(ctx);
  const v = addInput.parse(input);
  const m = await scopedMember(db, ctx, v.memberId);
  const h = await getHousehold(db, ctx, v.householdId);
  if (h.members.some((x) => x.memberId === m.id)) throw new ValidationError("Already in this family or cell.");
  if (v.relation === "HEAD" && h.members.some((x) => x.relation === "HEAD")) throw new ValidationError("This family or cell already has a head.");
  await db.$transaction(async (tx) => {
    await tx.householdMember.create({ data: { householdId: h.id, memberId: m.id, relation: v.relation } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "CREATE", entity: "Household", entityId: h.id, memberId: m.id, field: "household", newValue: `${h.name} · ${RELATION_LABELS[v.relation]}` });
  });
  if (v.relation === "SPOUSE" && v.linkSpouse) {
    const head = h.members.find((x) => x.relation === "HEAD")?.member;
    if (!head) throw new ValidationError("Add a head first to link spouses.");
    await updateMember(db, ctx, m.id, { maritalStatus: "MARRIED", spouseMemberId: head.id }, { note: `Linked as spouse in household ${h.name}` });
    await updateMember(db, ctx, head.id, { maritalStatus: "MARRIED", spouseMemberId: m.id }, { note: `Linked as spouse in household ${h.name}` });
  }
}

export async function setHouseholdRelation(db: Db, ctx: AuthContext, householdId: string, memberId: string, relation: HouseholdRelation) {
  assertCan(ctx, "household", "update");
  const h = await getHousehold(db, ctx, householdId);
  const row = h.members.find((x) => x.memberId === memberId);
  if (!row) throw new NotFoundError();
  if (relation === "HEAD" && h.members.some((x) => x.relation === "HEAD" && x.memberId !== memberId)) throw new ValidationError("This family or cell already has a head.");
  await db.$transaction(async (tx) => {
    await tx.householdMember.update({ where: { householdId_memberId: { householdId, memberId } }, data: { relation } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "UPDATE", entity: "Household", entityId: h.id, memberId, field: "household", oldValue: `${h.name} · ${RELATION_LABELS[row.relation]}`, newValue: `${h.name} · ${RELATION_LABELS[relation]}` });
  });
}

export async function removeFromHousehold(db: Db, ctx: AuthContext, householdId: string, memberId: string) {
  assertCan(ctx, "household", "update");
  const h = await getHousehold(db, ctx, householdId);
  const row = h.members.find((x) => x.memberId === memberId);
  if (!row) throw new NotFoundError();
  await db.$transaction(async (tx) => {
    await tx.householdMember.delete({ where: { householdId_memberId: { householdId, memberId } } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "DELETE", entity: "Household", entityId: h.id, memberId, field: "household", oldValue: `${h.name} · ${RELATION_LABELS[row.relation]}` });
    if (h.members.length === 1) await tx.household.delete({ where: { id: h.id } });
  });
}

/** Married couples (spouse links) not yet sharing a household — quick suggestions. */
export async function spouseHouseholdSuggestions(db: DbOrTx, ctx: AuthContext, take = 10) {
  assertRead(ctx);
  const pairs = await db.member.findMany({
    where: { AND: [memberScopeWhere(ctx) as Prisma.MemberWhereInput, LIVE, { spouseMemberId: { not: null }, households: { none: {} } }] },
    select: { id: true, memberId: true, lastName: true, firstName: true, spouse: { select: { id: true, memberId: true, lastName: true, firstName: true } } },
    take: take * 2,
  });
  const seen = new Set<string>();
  return pairs
    .filter((p) => p.spouse && !seen.has([p.id, p.spouse.id].sort().join()) && seen.add([p.id, p.spouse.id].sort().join()))
    .slice(0, take);
}
