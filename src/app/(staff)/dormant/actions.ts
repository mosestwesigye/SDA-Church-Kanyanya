"use server";

import { revalidatePath } from "next/cache";
import { attempt } from "@/server/action-result";
import { requireContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { activateMembers } from "@/server/members/dormant";

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
    revalidatePath("/transfers");
    const label = status === "ACTIVE" ? "Active" : "Irregular";
    return {
      message: `${done} member${done === 1 ? "" : "s"} marked ${label} and moved to the active register.${skipped ? ` ${skipped} skipped (deceased, or with an unfinished request under Transfers & status).` : ""}`,
    };
  });
}
