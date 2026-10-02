"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { attempt } from "@/server/action-result";
import { requireContext } from "@/server/auth/session";
import { memberScopeWhere } from "@/server/authz/policy";
import { db } from "@/server/db";
import { ValidationError } from "@/server/errors";
import { findDuplicateCandidates, isStrongDuplicate, type DuplicateCandidate } from "@/server/members/duplicates";
import { addMinistry, createMember, memberPatchSchema, updateMember } from "@/server/members/service";

export async function checkDuplicatesAction(input: { lastName?: string; firstName?: string; phone?: string | null; excludeId?: string }): Promise<DuplicateCandidate[]> {
  const ctx = await requireContext();
  return findDuplicateCandidates(db, ctx, input);
}

/** Member picker (e.g. spouse): name or ID search within the caller's scope. */
export async function searchMembersAction(q: string, excludeId?: string) {
  const ctx = await requireContext();
  const text = q.trim();
  if (text.length < 2) return [];
  const idNo = text.toUpperCase().replace(/\s+/g, "").match(/^(?:SDAK\/?)?M?(\d{1,6})$/);
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  const rows = await db.member.findMany({
    where: {
      AND: [
        memberScopeWhere(ctx) as Prisma.MemberWhereInput,
        { deletedAt: null, mergedIntoId: null, purgedAt: null, id: { not: excludeId ?? "" } },
        idNo
          ? { memberNo: Number(idNo[1]) }
          : { AND: tokens.map((t) => ({ OR: [{ lastName: { contains: t, mode: "insensitive" as const } }, { firstName: { contains: t, mode: "insensitive" as const } }] })) },
      ],
    },
    select: { id: true, memberId: true, lastName: true, firstName: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 8,
  });
  return rows;
}

const ministryPairs = z.array(z.object({ ministryId: z.string().min(1), roleId: z.string().min(1) })).max(20);

export async function createMemberAction(input: { fields: unknown; ministries: unknown; confirmedNotDuplicate: boolean }) {
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
    revalidatePath("/members");
    return { message: `Created ${m.memberId}.`, data: { id: m.id } };
  });
}

export async function updateMemberAction(id: string, version: number, patch: unknown) {
  return attempt<{ id: string }>(async () => {
    const ctx = await requireContext();
    const { changes } = await updateMember(db, ctx, id, patch, { expectedVersion: version });
    revalidatePath(`/members/${id}`);
    revalidatePath("/members");
    return { message: changes.length ? `Saved ${changes.length} change${changes.length === 1 ? "" : "s"}.` : "No changes to save.", data: { id } };
  });
}
