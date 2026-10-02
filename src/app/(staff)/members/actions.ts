"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { attempt } from "@/server/action-result";
import { requireContext } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { db } from "@/server/db";
import { ForbiddenError } from "@/server/errors";
import { addMinistry, flagForReview, restoreMember, softDeleteMember, updateMember } from "@/server/members/service";

const ids = z.array(z.string().min(1)).min(1).max(500);

async function eachMember(memberIds: string[], fn: (id: string) => Promise<unknown>) {
  let done = 0;
  const failed: string[] = [];
  for (const id of memberIds) {
    try {
      await fn(id);
      done++;
    } catch (e) {
      failed.push(e instanceof Error ? e.message : String(e));
    }
  }
  const msg = `${done} updated${failed.length ? `, ${failed.length} skipped (${[...new Set(failed)].slice(0, 2).join("; ")})` : ""}.`;
  return { message: msg };
}

export async function bulkAssignMinistryAction(memberIds: string[], ministryId: string, roleId: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    const list = ids.parse(memberIds);
    const r = await eachMember(list, (id) => addMinistry(db, ctx, id, ministryId, roleId));
    revalidatePath("/members");
    return r;
  });
}

export async function bulkSetZoneAction(memberIds: string[], zoneId: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    const list = ids.parse(memberIds);
    const r = await eachMember(list, (id) => updateMember(db, ctx, id, { zoneId }, { note: "Bulk: set zone" }));
    revalidatePath("/members");
    return r;
  });
}

export async function bulkFlagAction(memberIds: string[], reason: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    const n = await flagForReview(db, ctx, ids.parse(memberIds), reason);
    revalidatePath("/members");
    return { message: `${n} sent to the clean-up queue.` };
  });
}

export async function bulkDeleteAction(memberIds: string[], reason: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    if (!can(ctx, "member", "delete")) throw new ForbiddenError();
    if (reason.trim().length < 3) throw new ForbiddenError("Give a reason for deleting.");
    const r = await eachMember(ids.parse(memberIds), (id) => softDeleteMember(db, ctx, id, reason.trim()));
    revalidatePath("/members");
    return { message: `${r.message} Deleted records can be restored from “Recently deleted”.` };
  });
}

export async function restoreMemberAction(memberId: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    await restoreMember(db, ctx, memberId);
    revalidatePath("/members");
    return { message: "Member restored." };
  });
}

const viewSchema = z.object({ name: z.string().trim().min(1).max(40), search: z.string().max(500), columns: z.array(z.string()).max(20), shared: z.boolean() });

export async function saveViewAction(input: z.infer<typeof viewSchema>) {
  return attempt(async () => {
    const ctx = await requireContext();
    const v = viewSchema.parse(input);
    // Only roles that manage lists may share a view with everyone.
    const shared = v.shared && can(ctx, "admin.lists", "manage");
    await db.savedView.create({ data: { userId: ctx.userId, name: v.name, filters: { search: v.search }, columns: v.columns, shared } });
    revalidatePath("/members");
    return { message: `Saved view “${v.name}”.` };
  });
}

export async function deleteViewAction(viewId: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    await db.savedView.deleteMany({ where: { id: viewId, userId: ctx.userId } });
    revalidatePath("/members");
  });
}
