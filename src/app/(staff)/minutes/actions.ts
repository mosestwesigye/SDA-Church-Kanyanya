"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { attempt } from "@/server/action-result";
import { requireContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { flash } from "@/server/flash";
import { addMinutesFile, createMinutes, deleteMinutes, removeMinutesFile, updateMinutes, type MinutesInput } from "@/server/minutes/service";

export async function createMinutesAction(input: MinutesInput) {
  const ctx = await requireContext();
  return attempt<{ id: string; reference: string }>(async () => {
    const m = await createMinutes(db, ctx, input);
    revalidatePath("/minutes");
    return { data: { id: m.id, reference: m.reference } };
  });
}

export async function updateMinutesAction(id: string, input: MinutesInput) {
  const ctx = await requireContext();
  return attempt(async () => {
    const { changed } = await updateMinutes(db, ctx, id, input);
    revalidatePath("/minutes");
    revalidatePath(`/minutes/${id}`);
    return { message: changed.length ? "Minutes updated." : "No changes to save." };
  });
}

/** One file per call so each request stays under the upload limit. */
export async function uploadMinutesFileAction(minutesId: string, form: FormData) {
  const ctx = await requireContext();
  return attempt(async () => {
    const f = form.get("file");
    if (!(f instanceof File)) throw new Error("No file");
    const saved = await addMinutesFile(db, ctx, minutesId, { data: Buffer.from(await f.arrayBuffer()), name: f.name });
    revalidatePath(`/minutes/${minutesId}`);
    return { message: `${saved.fileName} uploaded.` };
  });
}

export async function removeMinutesFileAction(minutesId: string, fileId: string) {
  const ctx = await requireContext();
  return attempt(async () => {
    await removeMinutesFile(db, ctx, fileId);
    revalidatePath(`/minutes/${minutesId}`);
    return { message: "File removed." };
  });
}

export async function deleteMinutesAction(id: string, reason: string) {
  const ctx = await requireContext();
  const r = await attempt(async () => {
    await deleteMinutes(db, ctx, id, reason);
  });
  if (r.ok) {
    revalidatePath("/minutes");
    await flash("success", "Minutes removed", "They no longer appear in the register. The audit log keeps the record.");
    redirect("/minutes");
  }
  return r;
}
