"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseDob } from "@/lib/dob";
import { attempt } from "@/server/action-result";
import { requireContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { ValidationError } from "@/server/errors";
import { dismissRawValue, mapRawValues, mapInput, resolveFlag, setCleanupTarget } from "@/server/cleanup/mapping";
import { dismissDuplicate, mergeMembers, undoMerge } from "@/server/cleanup/merge";
import { addMinistry, updateMember, type MemberPatch } from "@/server/members/service";

const quick = z.object({
  gender: z.enum(["MALE", "FEMALE"]).optional(),
  dob: z.string().trim().max(20).optional(),
  zoneId: z.string().optional(),
  phone: z.string().trim().max(40).optional(),
  ministryId: z.string().optional(),
});

/** Inline quick-edit from the incomplete-records queue (only filled cells are sent). */
export async function quickSaveAction(memberId: string, version: number, input: z.input<typeof quick>) {
  return attempt<{ completeness: number; version: number }>(async () => {
    const ctx = await requireContext();
    const v = quick.parse(input);
    const patch: MemberPatch = {};
    if (v.gender) patch.gender = v.gender;
    if (v.zoneId) patch.zoneId = v.zoneId;
    if (v.phone) patch.phone = v.phone;
    if (v.dob) {
      const d = parseDob(v.dob);
      if (d.precision === "UNKNOWN") throw new ValidationError("Enter a year (1978) or a date (12/04/1978).", { dob: "Year or dd/mm/yyyy" });
      Object.assign(patch, d.precision === "FULL" ? { dobPrecision: "FULL", dobDate: d.date } : { dobPrecision: "YEAR", dobYear: d.year });
    }
    if (Object.keys(patch).length) await updateMember(db, ctx, memberId, patch, { expectedVersion: version, note: "Clean-up quick edit" });
    if (v.ministryId) {
      const role = await db.listItem.findFirstOrThrow({ where: { type: "MINISTRY_ROLE", label: "Member" } });
      await addMinistry(db, ctx, memberId, v.ministryId, role.id);
    }
    const m = await db.member.findUniqueOrThrow({ where: { id: memberId }, select: { completeness: true, version: true } });
    revalidatePath("/cleanup");
    return { message: "Saved", data: { completeness: m.completeness, version: m.version } };
  });
}

export async function mergeAction(survivorId: string, retiredId: string, choices: Record<string, "survivor" | "retired">) {
  return attempt(async () => {
    const ctx = await requireContext();
    const merge = await mergeMembers(db, ctx, { survivorId, retiredId, choices });
    revalidatePath("/cleanup");
    revalidatePath("/members");
    return { message: `Merged. The other ID is retired. You can undo this until ${merge.undoableUntil.toLocaleDateString("en-GB")}.` };
  });
}

export async function undoMergeAction(mergeId: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    const { keptLaterEdits } = await undoMerge(db, ctx, mergeId);
    revalidatePath("/cleanup");
    revalidatePath("/members");
    return { message: keptLaterEdits.length ? `Merge undone. Kept later edits to: ${keptLaterEdits.join(", ")}.` : "Merge undone." };
  });
}

export async function dismissDuplicateAction(a: string, b: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    await dismissDuplicate(db, ctx, a, b);
    revalidatePath("/cleanup");
    return { message: "Marked as not a duplicate." };
  });
}

export async function mapValuesAction(input: z.input<typeof mapInput>) {
  return attempt(async () => {
    const ctx = await requireContext();
    const r = await mapRawValues(db, ctx, input);
    revalidatePath("/cleanup");
    return { message: `${r.resolved} value${r.resolved === 1 ? "" : "s"} resolved, ${r.applied} record${r.applied === 1 ? "" : "s"} updated.${r.problems.length ? ` Skipped: ${r.problems.join("; ")}` : ""}` };
  });
}

export async function dismissRawValueAction(id: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    await dismissRawValue(db, ctx, id);
    revalidatePath("/cleanup");
  });
}

export async function resolveFlagAction(id: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    await resolveFlag(db, ctx, id);
    revalidatePath("/cleanup");
    return { message: "Marked as checked." };
  });
}

export async function setTargetAction(percent: number, dueDate: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    await setCleanupTarget(db, ctx, percent, dueDate);
    revalidatePath("/cleanup");
    return { message: "Target updated." };
  });
}
