"use server";

import { revalidatePath } from "next/cache";
import { attempt } from "@/server/action-result";
import { requireContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { activateMembers, requestReactivation } from "@/server/members/dormant";

const refresh = () => {
  revalidatePath("/dormant");
  revalidatePath("/dashboard");
  revalidatePath("/members");
};

export async function activateAction(ids: string[], status: "ACTIVE" | "IRREGULAR") {
  const ctx = await requireContext();
  return attempt(async () => {
    const { done, skipped } = await activateMembers(db, ctx, ids, status);
    refresh();
    const label = status === "ACTIVE" ? "Active" : "Irregular";
    return {
      message: `${done} member${done === 1 ? "" : "s"} marked ${label} and moved to the active register.${skipped ? ` ${skipped} skipped (already have a status — send those for approval).` : ""}`,
    };
  });
}

export async function requestReactivationAction(input: { memberId: string; toStatus: "ACTIVE" | "IRREGULAR"; reason: string; effectiveDate: string }) {
  const ctx = await requireContext();
  return attempt(async () => {
    await requestReactivation(db, ctx, input);
    refresh();
    revalidatePath("/transfers");
    return { message: "Sent for approval. The member moves to the active register once the Pastor approves." };
  });
}
