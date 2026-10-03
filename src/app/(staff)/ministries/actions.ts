"use server";

import { revalidatePath } from "next/cache";
import { attempt } from "@/server/action-result";
import { requireContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { addMinistry, removeMinistry } from "@/server/members/service";
import { setMinistryRole } from "@/server/ministries/service";

export async function setRoleAction(ministryId: string, linkId: string, roleId: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    await setMinistryRole(db, ctx, linkId, roleId);
    revalidatePath(`/ministries/${ministryId}`);
    return { message: "Role updated." };
  });
}

export async function addToMinistryAction(ministryId: string, memberId: string, roleId: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    await addMinistry(db, ctx, memberId, ministryId, roleId);
    revalidatePath(`/ministries/${ministryId}`);
    return { message: "Added to the ministry." };
  });
}

export async function removeFromMinistryAction(ministryId: string, linkId: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    await removeMinistry(db, ctx, linkId);
    revalidatePath(`/ministries/${ministryId}`);
    return { message: "Removed from the ministry." };
  });
}
