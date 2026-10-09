"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { attempt } from "@/server/action-result";
import { requireContext } from "@/server/auth/session";
import { can, memberScopeWhere } from "@/server/authz/policy";
import { db } from "@/server/db";
import { ValidationError } from "@/server/errors";
import { findDuplicateCandidates, isStrongDuplicate, type DuplicateCandidate } from "@/server/members/duplicates";
import { addMinistry, createMember, memberPatchSchema, updateMember } from "@/server/members/service";
import { joinHousehold, joinInput } from "@/server/households/service";
import type { RequestContext } from "@/server/auth/session";

type HouseholdChoice = { householdId?: string; newName?: string; kind?: "FAMILY" | "CELL"; relation: string } | null | undefined;

/** Optional family/cell placement after the member is saved; failures don't undo the member. */
async function placeInHousehold(ctx: RequestContext, memberId: string, choice: HouseholdChoice): Promise<string | null> {
  if (!choice || (!choice.householdId && !choice.newName)) return null;
  try {
    await joinHousehold(db, ctx, memberId, joinInput.parse(choice));
    revalidatePath("/families");
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Couldn’t add them to the family or cell.";
  }
}

export async function checkDuplicatesAction(input: { lastName?: string; firstName?: string; phone?: string | null; excludeId?: string }): Promise<DuplicateCandidate[]> {
  const ctx = await requireContext();
  return findDuplicateCandidates(db, ctx, input);
}

/** Member picker (e.g. spouse): name or ID search within the caller's scope. */
export async function searchMembersAction(q: string, excludeId?: string, excludeIds: string[] = []) {
  const ctx = await requireContext();
  const text = q.trim();
  if (text.length < 2) return [];
  const idNo = text.toUpperCase().replace(/\s+/g, "").match(/^(?:SDAK\/?)?M?(\d{1,6})$/);
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  const rows = await db.member.findMany({
    where: {
      AND: [
        memberScopeWhere(ctx) as Prisma.MemberWhereInput,
        { deletedAt: null, mergedIntoId: null, purgedAt: null, id: { notIn: [excludeId ?? "", ...excludeIds.slice(0, 200)] } },
        idNo
          ? { memberNo: Number(idNo[1]) }
          : { AND: tokens.map((t) => ({ OR: [{ lastName: { contains: t, mode: "insensitive" as const } }, { firstName: { contains: t, mode: "insensitive" as const } }] })) },
      ],
    },
    select: { id: true, memberId: true, lastName: true, firstName: true, ...(can(ctx, "member.profile", "read") ? { zone: { select: { label: true } } } : {}) },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 10,
  });
  return rows.map((r) => ({ id: r.id, memberId: r.memberId, lastName: r.lastName, firstName: r.firstName, zone: (r as { zone?: { label: string } | null }).zone?.label ?? null }));
}

const ministryPairs = z.array(z.object({ ministryId: z.string().min(1), roleId: z.string().min(1) })).max(20);

export async function createMemberAction(input: { fields: unknown; ministries: unknown; confirmedNotDuplicate: boolean; household?: HouseholdChoice }) {
  return attempt<{ id: string }>(async () => {
    const ctx = await requireContext();
    const fields = memberPatchSchema.parse(input.fields);
    const pairs = ministryPairs.parse(input.ministries ?? []);
    if (!input.confirmedNotDuplicate) {
      const dupes = (await findDuplicateCandidates(db, ctx, { lastName: fields.lastName, firstName: fields.firstName, phone: fields.phone })).filter(isStrongDuplicate);
      if (dupes.length) {
        throw new ValidationError(`This looks like ${dupes[0].lastName}, ${dupes[0].firstName} (${dupes[0].memberId}). Confirm it is a different person to save.`, {
          duplicate: dupes[0].id,
        });
      }
    }
    const m = await createMember(db, ctx, fields, { note: input.confirmedNotDuplicate ? "Saved after duplicate warning was confirmed" : undefined });
    for (const p of pairs) await addMinistry(db, ctx, m.id, p.ministryId, p.roleId);
    const householdProblem = await placeInHousehold(ctx, m.id, input.household);
    revalidatePath("/members");
    return { message: householdProblem ? `Created ${m.memberId}, but not added to the family or cell: ${householdProblem}` : `Created ${m.memberId}.`, data: { id: m.id } };
  });
}

export async function updateMemberAction(id: string, version: number, patch: unknown, household?: HouseholdChoice) {
  return attempt<{ id: string }>(async () => {
    const ctx = await requireContext();
    const { changes } = await updateMember(db, ctx, id, patch, { expectedVersion: version });
    const householdProblem = await placeInHousehold(ctx, id, household);
    if (householdProblem) throw new ValidationError(`${changes.length ? "Changes saved, but n" : "N"}ot added to the family or cell: ${householdProblem}`);
    revalidatePath(`/members/${id}`);
    revalidatePath("/members");
    return { message: changes.length ? `Saved ${changes.length} change${changes.length === 1 ? "" : "s"}.` : household ? "Added to the family or cell." : "No changes to save.", data: { id } };
  });
}
