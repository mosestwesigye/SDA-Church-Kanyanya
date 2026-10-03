import type { DocumentKind } from "@/generated/prisma/client";
import { AuditWriter } from "../audit/audit";
import { canOnMember, type AuthContext } from "../authz/policy";
import type { Db } from "../db";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, sniffType, storage } from "../storage";
import { actorFrom, refreshCompleteness } from "./service";

async function loadMember(db: Db, id: string) {
  const m = await db.member.findUnique({ where: { id }, include: { ministries: { select: { ministryId: true } } } });
  if (!m || m.purgedAt) throw new NotFoundError("Member not found.");
  return m;
}

function validate(file: { data: Buffer; name: string }, imagesOnly: boolean) {
  if (file.data.length === 0) throw new ValidationError("The file is empty.");
  if (file.data.length > MAX_UPLOAD_BYTES) throw new ValidationError("Files must be 4 MB or smaller.");
  const type = sniffType(file.data);
  if (!type || !ALLOWED_UPLOAD_TYPES.has(type) || (imagesOnly && !type.startsWith("image/"))) {
    throw new ValidationError(imagesOnly ? "Upload a JPEG, PNG or WebP photo." : "Upload a PDF, JPEG, PNG or WebP file.");
  }
  return type;
}

/** Upload or replace a member's photo (audited; updates completeness). */
export async function setMemberPhoto(db: Db, ctx: AuthContext, memberId: string, file: { data: Buffer; name: string }) {
  const m = await loadMember(db, memberId);
  if (!canOnMember(ctx, "member.profile", "update", m) || !canOnMember(ctx, "member", "update", m)) throw new ForbiddenError();
  const type = validate(file, true);
  const key = await storage().put(`photos/${m.id}`, file.name, file.data, type);
  const old = m.photoKey;
  await db.$transaction(async (tx) => {
    await tx.member.update({ where: { id: m.id }, data: { photoKey: key, version: { increment: 1 } } });
    await tx.document.create({ data: { memberId: m.id, kind: "PHOTO", fileName: file.name.slice(0, 200), storageKey: key, mimeType: type, sizeBytes: file.data.length, uploadedById: ctx.userId } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "UPDATE", entity: "Member", entityId: m.id, memberId: m.id, field: "photoKey", oldValue: old ? "previous photo" : null, newValue: "new photo" });
    await refreshCompleteness(tx, m.id);
  });
  return key;
}

export async function uploadDocument(db: Db, ctx: AuthContext, memberId: string, kind: DocumentKind, file: { data: Buffer; name: string }) {
  const m = await loadMember(db, memberId);
  if (!canOnMember(ctx, "document", "upload", m)) throw new ForbiddenError();
  const type = validate(file, false);
  const key = await storage().put(`documents/${m.id}`, file.name, file.data, type);
  return db.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: { memberId: m.id, kind, fileName: file.name.slice(0, 200), storageKey: key, mimeType: type, sizeBytes: file.data.length, uploadedById: ctx.userId },
    });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "CREATE", entity: "Document", entityId: doc.id, memberId: m.id, field: "document", newValue: `${kind}: ${doc.fileName}` });
    return doc;
  });
}

/** Authorise and fetch a stored file for download. Photos need profile read; others need document read. */
export async function openDocument(db: Db, ctx: AuthContext, documentId: string) {
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc || doc.deletedAt || !doc.memberId) throw new NotFoundError();
  const m = await loadMember(db, doc.memberId);
  const allowed = doc.kind === "PHOTO" ? canOnMember(ctx, "member.profile", "read", m) : canOnMember(ctx, "document", "read", m);
  if (!allowed) throw new ForbiddenError();
  const file = await storage().get(doc.storageKey);
  if (!file) throw new NotFoundError("File missing from storage.");
  return { doc, file };
}
