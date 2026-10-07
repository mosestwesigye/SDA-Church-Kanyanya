"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { attempt } from "@/server/action-result";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { ValidationError } from "@/server/errors";
import { commitBatch, commitBatchSkippingErrors, commitStep, saveMapping, startImport, type mappingSchema } from "@/server/import/wizard";
import type { z } from "zod";
import { flash } from "@/server/flash";

export async function uploadAction(_: unknown, form: FormData) {
  const ctx = await requirePermission("import", "run");
  const r = await attempt<{ id: string }>(async () => {
    const f = form.get("file");
    if (!(f instanceof File) || f.size === 0) throw new ValidationError("Choose the register file first.");
    const { batch } = await startImport(db, ctx, { name: f.name, data: Buffer.from(await f.arrayBuffer()) });
    return { data: { id: batch.id } };
  });
  if (r.ok) {
    await flash("success", "File uploaded", "Next, match the spreadsheet columns to register fields.");
    redirect(`/import/${r.data!.id}?step=map`);
  }
  return r;
}

export async function saveMappingAction(batchId: string, mapping: z.input<typeof mappingSchema>) {
  const ctx = await requirePermission("import", "run");
  const r = await attempt(async () => {
    await saveMapping(db, ctx, batchId, mapping);
  });
  if (r.ok) {
    await flash("success", "Column mapping saved", "Review the checks before importing.");
    redirect(`/import/${batchId}?step=validate`);
  }
  return r;
}

export async function commitAction(batchId: string, skipErrors: boolean) {
  const ctx = await requirePermission("import", "run");
  const r = await attempt(async () => {
    if (skipErrors) await commitBatchSkippingErrors(db, ctx, batchId);
    else await commitBatch(db, ctx, batchId);
  });
  if (r.ok) {
    revalidatePath("/members");
    await flash("success", "Import complete");
    redirect(`/import/${batchId}`);
  }
  return r;
}

/** One round of a commit (about 40 seconds of writing); the page calls it until done. */
export async function commitStepAction(batchId: string, skipErrors: boolean) {
  const ctx = await requirePermission("import", "run");
  const r = await attempt<{ done: boolean; written: number; total: number }>(async () => {
    const data = await commitStep(db, ctx, batchId, { skipErrors });
    return { data };
  });
  if (r.ok && r.data?.done) revalidatePath("/members");
  return r;
}
