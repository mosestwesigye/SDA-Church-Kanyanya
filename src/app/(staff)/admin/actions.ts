"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { setPhotoRequired } from "@/server/settings/completeness";

export type RulesState = { ok?: string; error?: string } | undefined;

export async function setPhotoRequiredAction(_: RulesState, form: FormData): Promise<RulesState> {
  const ctx = await requirePermission("admin.lists", "manage");
  const required = form.get("photoRequired") === "on";
  const { changed } = await setPhotoRequired(db, ctx, required);
  revalidatePath("/", "layout");
  return {
    ok: `${required ? "Photo now counts" : "Photo no longer counts"} toward completeness. ${changed.toLocaleString("en-UG")} member scores updated.`,
  };
}
