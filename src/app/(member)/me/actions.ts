"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { attempt } from "@/server/action-result";
import { requireContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { cancelOwnCorrectionRequest, createCorrectionRequest, recordSelfServiceConsent } from "@/server/selfservice/service";
import { flash } from "@/server/flash";

export async function acceptPrivacyAction() {
  const ctx = await requireContext();
  await recordSelfServiceConsent(db, ctx);
  revalidatePath("/me");
  await flash("success", "Thank you", "Your agreement to the privacy notice is recorded.");
  redirect("/me?consent=1");
}

export async function submitCorrectionAction(input: Record<string, unknown>) {
  const ctx = await requireContext();
  const r = await attempt(async () => {
    await createCorrectionRequest(db, ctx, input);
  });
  if (r.ok) {
    await flash("success", "Request sent to the church clerk", "You’ll see the outcome here once it has been reviewed.");
    redirect("/me?sent=1");
  }
  return r;
}

export async function cancelCorrectionAction(id: string) {
  const ctx = await requireContext();
  return attempt(async () => {
    await cancelOwnCorrectionRequest(db, ctx, id);
    return { message: "Request cancelled." };
  });
}
