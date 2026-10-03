"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { HouseholdRelation } from "@/generated/prisma/client";
import { attempt } from "@/server/action-result";
import { requireContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { addToHousehold, createHousehold, removeFromHousehold, setHouseholdRelation } from "@/server/households/service";

export async function createHouseholdAction(name: string, headMemberId: string) {
  const r = await attempt<{ id: string }>(async () => {
    const ctx = await requireContext();
    const h = await createHousehold(db, ctx, { name, headMemberId });
    return { data: { id: h.id } };
  });
  if (r.ok) redirect(`/families/${r.data!.id}`);
  return r;
}

export async function addMemberAction(householdId: string, memberId: string, relation: HouseholdRelation, linkSpouse: boolean) {
  return attempt(async () => {
    const ctx = await requireContext();
    await addToHousehold(db, ctx, { householdId, memberId, relation, linkSpouse });
    revalidatePath(`/families/${householdId}`);
    return { message: linkSpouse ? "Added and linked as spouse on both records." : "Added to the household." };
  });
}

export async function setRelationAction(householdId: string, memberId: string, relation: HouseholdRelation) {
  return attempt(async () => {
    const ctx = await requireContext();
    await setHouseholdRelation(db, ctx, householdId, memberId, relation);
    revalidatePath(`/families/${householdId}`);
  });
}

export async function removeMemberAction(householdId: string, memberId: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    await removeFromHousehold(db, ctx, householdId, memberId);
    revalidatePath(`/families/${householdId}`);
    revalidatePath("/families");
    return { message: "Removed from the household." };
  });
}
