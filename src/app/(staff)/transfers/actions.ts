"use server";

import { revalidatePath } from "next/cache";
import { attempt } from "@/server/action-result";
import { requireContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { ValidationError } from "@/server/errors";
import { uploadDocument } from "@/server/members/documents";
import { advanceTransfer, cancelStatusRequest, createStatusRequest, decideStatusRequest, purgeMember } from "@/server/workflows/status";

function refresh(memberId?: string) {
  revalidatePath("/transfers");
  revalidatePath("/dashboard");
  if (memberId) revalidatePath(`/members/${memberId}`);
}

export async function createRequestAction(form: FormData) {
  return attempt<{ id: string }>(async () => {
    const ctx = await requireContext();
    const memberId = String(form.get("memberId") ?? "");
    const type = String(form.get("type") ?? "");
    let documentId: string | undefined;
    const file = form.get("file");
    if (file instanceof File && file.size > 0) {
      const kind = type === "DEATH" ? "DEATH_CERTIFICATE" : type.startsWith("TRANSFER") ? "TRANSFER_LETTER" : "BOARD_MINUTE";
      documentId = (await uploadDocument(db, ctx, memberId, kind, { name: file.name, data: Buffer.from(await file.arrayBuffer()) })).id;
    }
    const req = await createStatusRequest(db, ctx, {
      memberId,
      type: type as never,
      toStatus: (form.get("toStatus") || undefined) as never,
      reason: String(form.get("reason") ?? ""),
      effectiveDate: String(form.get("effectiveDate") ?? ""),
      otherChurch: String(form.get("otherChurch") ?? "") || undefined,
      documentId,
    });
    refresh(memberId);
    return { message: "Request sent for approval.", data: { id: req.id } };
  });
}

export async function decideAction(requestId: string, approve: boolean, note: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    const r = await decideStatusRequest(db, ctx, requestId, approve, note);
    refresh();
    return { message: r.state === "APPROVED" ? "Approved — the member’s status and history are updated." : "Rejected." };
  });
}

export async function cancelRequestAction(requestId: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    await cancelStatusRequest(db, ctx, requestId);
    refresh();
    return { message: "Request cancelled." };
  });
}

export async function advanceTransferAction(transferId: string, stage: "LETTER_SENT" | "LETTER_RECEIVED" | "COMPLETED", notes: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    await advanceTransfer(db, ctx, transferId, stage, notes || undefined);
    refresh();
    return { message: "Transfer updated." };
  });
}

export async function purgeMemberAction(memberId: string, confirmId: string) {
  return attempt(async () => {
    const ctx = await requireContext();
    const m = await db.member.findUnique({ where: { id: memberId }, select: { memberId: true } });
    if (!m || confirmId.trim().toUpperCase() !== m.memberId) throw new ValidationError(`Type ${m?.memberId ?? "the member ID"} to confirm.`);
    await purgeMember(db, ctx, memberId);
    revalidatePath("/members");
    return { message: "Personal data purged. The member ID stays retired." };
  });
}
