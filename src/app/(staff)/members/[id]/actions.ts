"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { attempt } from "@/server/action-result";
import { requireContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { ValidationError } from "@/server/errors";
import { setMemberPhoto, uploadDocument } from "@/server/members/documents";
import { addMinistry, flagForReview, removeMinistry, restoreMember, softDeleteMember } from "@/server/members/service";

async function fileFrom(form: FormData, name = "file") {
  const f = form.get(name);
  if (!(f instanceof File) || f.size === 0) throw new ValidationError("Choose a file first.");
  return { data: Buffer.from(await f.arrayBuffer()), name: f.name };
}

export async function uploadPhotoAction(memberId: string, form: FormData) {
  return attempt(async () => {
    const ctx = await requireContext();
    await setMemberPhoto(db, ctx, memberId, await fileFrom(form));
    revalidatePath(`/members/${memberId}`);
    return { message: "Photo saved." };
  });
}

const KINDS = ["CONSENT_FORM", "TRANSFER_LETTER", "DEATH_CERTIFICATE", "BOARD_MINUTE", "OTHER"] as const;

export async function uploadDocumentAction(memberId: string, form: FormData) {
  return attempt(async () => {
    const ctx = await requireContext();
    const kind = z.enum(KINDS).parse(form.get("kind"));
    await uploadDocument(db, ctx, memberId, kind, await fileFrom(form));
    revalidatePath(`/members/${memberId}`);
    return { message: "Document uploaded." };
  });
}

export async function addMinistryAction(memberId: string, ministryId: string, roleId: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    await addMinistry(db, ctx, memberId, ministryId, roleId);
    revalidatePath(`/members/${memberId}`);
    return { message: "Ministry added." };
  });
}

export async function removeMinistryAction(memberId: string, linkId: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    await removeMinistry(db, ctx, linkId);
    revalidatePath(`/members/${memberId}`);
    return { message: "Ministry removed." };
  });
}

export async function deleteMemberAction(memberId: string, reason: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    if (reason.trim().length < 3) throw new ValidationError("Give a reason for deleting.");
    await softDeleteMember(db, ctx, memberId, reason.trim());
    revalidatePath(`/members/${memberId}`);
    revalidatePath("/members");
    return { message: "Member moved to Recently deleted." };
  });
}

export async function restoreMemberProfileAction(memberId: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    await restoreMember(db, ctx, memberId);
    revalidatePath(`/members/${memberId}`);
    return { message: "Member restored." };
  });
}

export async function flagMemberAction(memberId: string, reason: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    await flagForReview(db, ctx, [memberId], reason);
    revalidatePath(`/members/${memberId}`);
    return { message: "Sent to the clean-up queue." };
  });
}
