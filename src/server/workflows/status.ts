import { z } from "zod";
import type { MembershipEventType, MembershipStatus, Prisma, StatusChangeType, TransferStage } from "@/generated/prisma/client";
import { STATUS_META } from "@/lib/labels";
import { AuditWriter } from "../audit/audit";
import { assertCan, can, canOnMember, memberScopeWhere, type AuthContext } from "../authz/policy";
import type { Db } from "../db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { actorFrom, refreshCompleteness } from "../members/service";
import { storage } from "../storage";

/** What each request type does to the membership status. */
export const REQUEST_TYPES: Record<StatusChangeType, { label: string; to: MembershipStatus | null; event: MembershipEventType }> = {
  TRANSFER_OUT: { label: "Transfer out", to: "SELF_TRANSFERRED", event: "TRANSFER_OUT" },
  TRANSFER_IN: { label: "Transfer in", to: "ACTIVE", event: "TRANSFER_IN" },
  DEATH: { label: "Record a death", to: "DECEASED", event: "DEATH" },
  DISCIPLINE: { label: "Discipline", to: "UNDER_DISCIPLINE", event: "DISCIPLINE" },
  RESTORATION: { label: "Restoration", to: "ACTIVE", event: "RESTORATION" },
  STATUS_UPDATE: { label: "Other status change", to: null, event: "STATUS_CHANGE" },
};

export const requestInput = z
  .object({
    memberId: z.string().min(1),
    type: z.enum(["TRANSFER_IN", "TRANSFER_OUT", "DEATH", "DISCIPLINE", "RESTORATION", "STATUS_UPDATE"]),
    toStatus: z.enum(["ACTIVE", "IRREGULAR", "SELF_TRANSFERRED", "UNDER_DISCIPLINE", "DECEASED", "LEFT_THE_FAITH"]).optional(),
    reason: z.string().trim().min(5, "Give the reason (at least a few words)").max(1000),
    effectiveDate: z.iso.date(),
    documentId: z.string().optional(),
    otherChurch: z.string().trim().max(120).optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.type === "TRANSFER_IN" || v.type === "TRANSFER_OUT") && !v.otherChurch) ctx.addIssue({ code: "custom", path: ["otherChurch"], message: "Name the other church" });
    if (v.type === "STATUS_UPDATE" && !v.toStatus) ctx.addIssue({ code: "custom", path: ["toStatus"], message: "Choose the new status" });
    if (new Date(`${v.effectiveDate}T00:00:00Z`) > new Date(Date.now() + 366 * 86400_000)) ctx.addIssue({ code: "custom", path: ["effectiveDate"], message: "Date is too far ahead" });
  });

async function scopedMember(db: Db, ctx: AuthContext, id: string) {
  const m = await db.member.findFirst({
    where: { AND: [memberScopeWhere(ctx) as Prisma.MemberWhereInput, { id, purgedAt: null, mergedIntoId: null }] },
    include: { ministries: { select: { ministryId: true } } },
  });
  if (!m) throw new NotFoundError("Member not found.");
  return m;
}

/** Who may change a membership status (Clerk, Assistant Clerk and Pastor by default). */
export function canChangeStatus(ctx: AuthContext) {
  return can(ctx, "status_request", "create");
}

/**
 * Change a member's status. Changes apply immediately (no approval step); the
 * change is still recorded as a request with its reason and date, written to
 * the member's history, and audited.
 */
export async function createStatusRequest(db: Db, ctx: AuthContext, input: z.input<typeof requestInput>) {
  if (!canChangeStatus(ctx)) throw new ForbiddenError("You can’t change membership status.");
  const v = requestInput.parse(input);
  const m = await scopedMember(db, ctx, v.memberId);
  if (m.deletedAt) throw new ValidationError("Restore this member first.");
  const to = (v.type === "STATUS_UPDATE" ? v.toStatus : REQUEST_TYPES[v.type].to)!;
  if (to === m.status) throw new ValidationError(`${m.memberId} is already ${STATUS_META[to].label}.`);
  if (m.status === "DECEASED" && v.type !== "STATUS_UPDATE") throw new ValidationError("This member is recorded as deceased.");
  const open = await db.statusChangeRequest.findFirst({ where: { memberId: m.id, state: "PENDING" } });
  if (open) throw new ConflictError("This member has an unfinished request from before. Apply or discard it under Transfers & status first.");
  if (v.documentId) {
    const doc = await db.document.findFirst({ where: { id: v.documentId, memberId: m.id, deletedAt: null } });
    if (!doc) throw new ValidationError("Supporting document not found on this member.");
  }

  return db.$transaction(async (tx) => {
    const transfer =
      v.type === "TRANSFER_IN" || v.type === "TRANSFER_OUT"
        ? await tx.transfer.create({
            data: { memberId: m.id, direction: v.type === "TRANSFER_IN" ? "IN" : "OUT", otherChurch: v.otherChurch!, createdById: ctx.userId },
          })
        : null;
    const req = await tx.statusChangeRequest.create({
      data: {
        memberId: m.id,
        type: v.type,
        fromStatus: m.status,
        toStatus: to,
        reason: v.reason,
        effectiveDate: new Date(`${v.effectiveDate}T00:00:00Z`),
        documentId: v.documentId ?? null,
        requestedById: ctx.userId,
        transferId: transfer?.id ?? null,
      },
    });
    await new AuditWriter(tx, actorFrom(ctx), "WORKFLOW").log({
      action: "CREATE",
      entity: "StatusChangeRequest",
      entityId: req.id,
      memberId: m.id,
      field: "status",
      oldValue: m.status,
      newValue: to,
      note: `${REQUEST_TYPES[v.type].label}${v.otherChurch ? ` (${v.otherChurch})` : ""}`,
    });
    await applyStatusChange(tx, ctx, req.id);
    return tx.statusChangeRequest.findUniqueOrThrow({ where: { id: req.id } });
  });
}

/** Apply a status change: set the status, record it in the member's history, move a transfer on. */
async function applyStatusChange(tx: Prisma.TransactionClient, ctx: AuthContext, requestId: string) {
  const req = await tx.statusChangeRequest.findUniqueOrThrow({ where: { id: requestId }, include: { member: true, transfer: true } });
  const audit = new AuditWriter(tx, actorFrom(ctx), "WORKFLOW");
  if (req.state === "PENDING") {
    await tx.statusChangeRequest.update({ where: { id: req.id }, data: { state: "APPROVED", decidedById: ctx.userId, decidedAt: new Date() } });
  }
  // Status may have changed since the request was made; record what it actually was.
  const before = req.member.status;
  await audit.logChanges("Member", req.memberId, { status: before }, { status: req.toStatus }, { memberId: req.memberId, note: `${REQUEST_TYPES[req.type].label}: ${req.reason}`.slice(0, 300) });
  await tx.member.update({ where: { id: req.memberId }, data: { status: req.toStatus, version: { increment: 1 } } });
  const typeInfo = REQUEST_TYPES[req.type];
  await tx.membershipEvent.create({
    data: {
      memberId: req.memberId,
      type: typeInfo.event,
      occurredOn: req.effectiveDate,
      title:
        req.type === "TRANSFER_OUT" ? `Transferred out to ${req.transfer?.otherChurch}`
        : req.type === "TRANSFER_IN" ? `Transferred in from ${req.transfer?.otherChurch}`
        : req.type === "DEATH" ? "Death recorded"
        : `Status: ${before ? STATUS_META[before].label : "Not recorded"} → ${STATUS_META[req.toStatus].label}`,
      detail: req.reason,
      fromStatus: before,
      toStatus: req.toStatus,
      requestId: req.id,
      approvedById: ctx.userId,
      createdById: req.requestedById,
    },
  });
  if (req.transfer) await tx.transfer.update({ where: { id: req.transfer.id }, data: { stage: "BOARD_APPROVED", boardApprovedAt: new Date() } });
  await refreshCompleteness(tx, req.memberId);
}

/**
 * Requests made before status changes stopped needing approval may still be
 * open. Applying one sets the status as if it had just been recorded.
 */
export async function applyPendingStatusRequest(db: Db, ctx: AuthContext, requestId: string) {
  if (!canChangeStatus(ctx)) throw new ForbiddenError("You can’t change membership status.");
  return db.$transaction(async (tx) => {
    const req = await tx.statusChangeRequest.findUnique({ where: { id: requestId }, include: { member: { include: { ministries: { select: { ministryId: true } } } } } });
    if (!req) throw new NotFoundError("Request not found.");
    if (req.state !== "PENDING") throw new ConflictError("This request was already finished.");
    if (!canOnMember(ctx, "status_request", "create", req.member)) throw new ForbiddenError();
    await applyStatusChange(tx, ctx, req.id);
    return { state: "APPROVED" as const };
  });
}

export async function cancelStatusRequest(db: Db, ctx: AuthContext, requestId: string) {
  const req = await db.statusChangeRequest.findUnique({ where: { id: requestId }, include: { transfer: true } });
  if (!req) throw new NotFoundError();
  if (req.state !== "PENDING") throw new ConflictError("This request was already decided.");
  if (req.requestedById !== ctx.userId && !canChangeStatus(ctx)) throw new ForbiddenError();
  await db.$transaction(async (tx) => {
    await tx.statusChangeRequest.update({ where: { id: req.id }, data: { state: "CANCELLED", decidedById: ctx.userId, decidedAt: new Date() } });
    if (req.transfer) await tx.transfer.update({ where: { id: req.transfer.id }, data: { stage: "CANCELLED" } });
    await new AuditWriter(tx, actorFrom(ctx), "WORKFLOW").log({ action: "UPDATE", entity: "StatusChangeRequest", entityId: req.id, memberId: req.memberId, field: "state", oldValue: "PENDING", newValue: "CANCELLED" });
  });
}

const STAGE_FIELD: Partial<Record<TransferStage, "letterSentAt" | "letterReceivedAt" | "completedAt">> = {
  LETTER_SENT: "letterSentAt",
  LETTER_RECEIVED: "letterReceivedAt",
  COMPLETED: "completedAt",
};

/** Track transfer letters: sent (out) / received (in), then completed. */
export async function advanceTransfer(db: Db, ctx: AuthContext, transferId: string, stage: "LETTER_SENT" | "LETTER_RECEIVED" | "COMPLETED", notes?: string) {
  assertCan(ctx, "transfer", "update");
  const t = await db.transfer.findUnique({ where: { id: transferId } });
  if (!t) throw new NotFoundError();
  if (t.stage === "CANCELLED" || t.stage === "COMPLETED") throw new ValidationError("This transfer is closed.");
  if (stage === "LETTER_SENT" && t.direction !== "OUT") throw new ValidationError("Letters are sent for transfers out.");
  if (stage === "LETTER_RECEIVED" && t.direction !== "IN") throw new ValidationError("Letters are received for transfers in.");
  // BOARD_APPROVED now means "status applied" (it is set when the transfer is recorded).
  if (stage === "COMPLETED" && t.stage !== "BOARD_APPROVED") throw new ValidationError("Apply the status change for this transfer first.");
  if (stage === "COMPLETED" && !t.letterSentAt && !t.letterReceivedAt) throw new ValidationError("Record the transfer letter first.");
  const field = STAGE_FIELD[stage]!;
  await db.$transaction(async (tx) => {
    // Letter stages are recorded without moving back past the applied status.
    const nextStage = stage === "COMPLETED" ? "COMPLETED" : t.stage === "BOARD_APPROVED" ? "BOARD_APPROVED" : stage;
    await tx.transfer.update({ where: { id: t.id }, data: { stage: nextStage, [field]: new Date(), notes: notes ?? t.notes } });
    await new AuditWriter(tx, actorFrom(ctx), "WORKFLOW").log({ action: "UPDATE", entity: "Transfer", entityId: t.id, memberId: t.memberId, field: "stage", oldValue: t.stage, newValue: stage, note: notes ?? null });
  });
}

/* ───────────────────────── Purge ───────────────────────── */

export async function retentionDays(db: Db) {
  return Number((await db.appSetting.findUnique({ where: { key: "retention.purgeAfterDays" } }))?.value ?? 365);
}

/**
 * Permanently remove a soft-deleted member's personal data (Admin only, after
 * the retention period). The row is kept as a tombstone so the ID is never
 * reused; linked documents and photos are deleted from storage.
 */
export async function purgeMember(db: Db, ctx: AuthContext, memberId: string) {
  assertCan(ctx, "member", "purge");
  const m = await db.member.findUnique({ where: { id: memberId } });
  if (!m || m.purgedAt) throw new NotFoundError();
  if (!m.deletedAt) throw new ValidationError("Only deleted members can be purged.");
  const days = await retentionDays(db);
  const eligible = new Date(m.deletedAt.getTime() + days * 86400_000);
  if (eligible > new Date()) throw new ValidationError(`This record can be purged from ${eligible.toLocaleDateString("en-GB")} (retention period ${days} days).`);

  const docs = await db.document.findMany({ where: { memberId } });
  await db.$transaction(async (tx) => {
    await tx.memberMinistry.deleteMany({ where: { memberId } });
    await tx.householdMember.deleteMany({ where: { memberId } });
    await tx.rawValue.deleteMany({ where: { memberId } });
    await tx.reviewFlag.deleteMany({ where: { memberId } });
    await tx.consent.deleteMany({ where: { memberId } });
    await tx.document.deleteMany({ where: { memberId } });
    await tx.member.updateMany({ where: { spouseMemberId: memberId }, data: { spouseMemberId: null } });
    await tx.user.updateMany({ where: { memberId }, data: { memberId: null, active: false } });
    await tx.member.update({
      where: { id: memberId },
      data: {
        lastName: "Purged record",
        firstName: "",
        gender: null, dobDate: null, dobYear: null, dobPrecision: "UNKNOWN", yearJoined: null, photoKey: null, zoneId: null,
        phoneRaw: null, phoneE164: null, email: null, status: null, maritalStatus: null, spouseMemberId: null, spouseName: null,
        nextOfKinName: null, nextOfKinPhoneRaw: null, nextOfKinPhoneE164: null, professionId: null,
        completeness: 0, missingFields: [], purgedAt: new Date(), version: { increment: 1 },
      },
    });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "PURGE", entity: "Member", entityId: memberId, memberId, note: `Personal data purged; ${m.memberId} retired permanently` });
  });
  // Storage cleanup after the database commit (best effort; logged keys are already unlinked).
  for (const d of docs) await storage().remove(d.storageKey).catch(() => undefined);
}
