"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { HouseholdKind, HouseholdRelation } from "@/generated/prisma/client";
import { attempt } from "@/server/action-result";
import { requireContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { flash } from "@/server/flash";
import { addToHousehold, createHousehold, KINDS, removeFromHousehold, renameHousehold, setHouseholdRelation } from "@/server/households/service";

/** Shared by the Families and Cells modules. */
function refresh(id?: string) {
  for (const k of Object.values(KINDS)) {
    revalidatePath(k.path);
    if (id) revalidatePath(`${k.path}/${id}`);
  }
}

export async function createHouseholdAction(input: { kind: HouseholdKind; name: string; headMemberId?: string; spouseMemberId?: string; linkSpouses?: boolean }) {
  const r = await attempt<{ id: string }>(async () => {
    const ctx = await requireContext();
    const h = await createHousehold(db, ctx, input);
    return { data: { id: h.id } };
  });
  if (r.ok) {
    refresh();
    const k = KINDS[input.kind];
    await flash("success", `${k.title} created`, input.kind === "FAMILY" ? "Now add the children and other family members." : "Now add the cell members.");
    redirect(`${k.path}/${r.data!.id}`);
  }
  return r;
}

export async function renameHouseholdAction(id: string, name: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    await renameHousehold(db, ctx, id, name);
    refresh(id);
    return { message: "Name updated." };
  });
}

export async function addMemberAction(householdId: string, memberId: string, relation: HouseholdRelation, linkSpouse: boolean) {
  return attempt(async () => {
    const ctx = await requireContext();
    await addToHousehold(db, ctx, { householdId, memberId, relation, linkSpouse });
    refresh(householdId);
    return { message: linkSpouse ? "Added and linked as spouses on both records." : "Member added." };
  });
}

export async function setRelationAction(householdId: string, memberId: string, relation: HouseholdRelation) {
  return attempt(async () => {
    const ctx = await requireContext();
    await setHouseholdRelation(db, ctx, householdId, memberId, relation);
    refresh(householdId);
    return { message: "Role updated." };
  });
}

export async function removeMemberAction(householdId: string, memberId: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    await removeFromHousehold(db, ctx, householdId, memberId);
    refresh(householdId);
    return { message: "Member removed." };
  });
}
