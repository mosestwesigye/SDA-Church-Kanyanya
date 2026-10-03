"use server";

import { attempt } from "@/server/action-result";
import { requireContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { decideCorrectionRequest } from "@/server/selfservice/service";

export async function decideCorrectionAction(id: string, approve: boolean, fields: string[], note: string) {
  const ctx = await requireContext();
  return attempt(async () => {
    const r = await decideCorrectionRequest(db, ctx, id, { approve, fields, note });
    return { message: approve ? `Applied ${r.applied.length} change${r.applied.length === 1 ? "" : "s"}.` : "Rejected." };
  });
}
