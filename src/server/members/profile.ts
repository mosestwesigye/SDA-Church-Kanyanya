import type { Prisma } from "@/generated/prisma/client";
import { can, canOnMember, memberScopeWhere, memberSelect, projectMember, type AuthContext } from "../authz/policy";
import type { DbOrTx } from "../db";

export type ProfileTab = "personal" | "family" | "ministry" | "history" | "documents" | "audit";

/**
 * Everything the profile page needs, loaded with the caller's scope and
 * field restrictions. Returns null when the member doesn't exist or is out
 * of scope (the page shows "not found" either way, so scope isn't leaked).
 */
export async function getMemberProfile(db: DbOrTx, ctx: AuthContext, id: string, opts: { auditPage?: number } = {}) {
  const where: Prisma.MemberWhereInput = { AND: [memberScopeWhere(ctx) as Prisma.MemberWhereInput, { id, purgedAt: null }] };
  const raw = await db.member.findFirst({
    where,
    select: { ...(memberSelect(ctx) as Prisma.MemberSelect), deletedAt: true, mergedIntoId: true, version: true },
  });
  if (!raw) return null;
  const row = raw as unknown as Record<string, unknown> & { id: string; ministries: { ministryId: string }[] };
  if (row.deletedAt && !can(ctx, "member", "restore")) return null;
  const m = projectMember(ctx, row);

  const sensitive = canOnMember(ctx, "member.sensitive", "read", row);
  const profile = canOnMember(ctx, "member.profile", "read", row);
  const docsAllowed = canOnMember(ctx, "document", "read", row);
  const auditAllowed = can(ctx, "audit", "read");
  const auditPage = Math.max(1, opts.auditPage ?? 1);

  const [photo, events, documents, consent, audit, auditTotal, lastChange, openFlags, mergedInto] = await Promise.all([
    profile && row.photoKey ? db.document.findFirst({ where: { memberId: id, kind: "PHOTO", storageKey: String(row.photoKey) }, select: { id: true } }) : null,
    db.membershipEvent.findMany({
      where: { memberId: id, ...(sensitive ? {} : { type: { not: "DISCIPLINE" } }) },
      orderBy: [{ occurredOn: "desc" }, { occurredYear: "desc" }, { createdAt: "desc" }],
    }),
    docsAllowed ? db.document.findMany({ where: { memberId: id, deletedAt: null, kind: { not: "PHOTO" } }, orderBy: { createdAt: "desc" } }) : [],
    profile ? db.consent.findFirst({ where: { memberId: id, withdrawnAt: null }, orderBy: { consentedAt: "desc" } }) : null,
    auditAllowed ? db.auditLog.findMany({ where: { memberId: id }, orderBy: { id: "desc" }, take: 50, skip: (auditPage - 1) * 50 }) : [],
    auditAllowed ? db.auditLog.count({ where: { memberId: id } }) : 0,
    db.auditLog.findFirst({ where: { memberId: id, action: { in: ["UPDATE", "CREATE", "DELETE", "RESTORE", "MERGE"] } }, orderBy: { id: "desc" }, select: { at: true, actorLabel: true } }),
    can(ctx, "cleanup", "use") ? db.reviewFlag.findMany({ where: { memberId: id, resolvedAt: null } }) : [],
    row.mergedIntoId ? db.member.findUnique({ where: { id: String(row.mergedIntoId) }, select: { id: true, memberId: true } }) : null,
  ]);

  // Discipline history and sensitive audit values are hidden from roles without sensitive access.
  const SENSITIVE_FIELDS = new Set(["maritalStatus", "spouseMemberId", "spouseName", "nextOfKinName", "nextOfKinPhoneRaw", "nextOfKinPhoneE164"]);
  // Show list labels instead of ids for zone/profession changes.
  const LIST_FIELDS = new Set(["zoneId", "professionId"]);
  const listIds = [...new Set(audit.filter((a) => a.field && LIST_FIELDS.has(a.field)).flatMap((a) => [a.oldValue, a.newValue]).filter((v): v is string => typeof v === "string"))];
  const labels = new Map((listIds.length ? await db.listItem.findMany({ where: { id: { in: listIds } }, select: { id: true, label: true } }) : []).map((l) => [l.id, l.label]));
  const label = (v: unknown) => (typeof v === "string" ? (labels.get(v) ?? v) : v);
  const auditRows = audit.map((a) =>
    !sensitive && a.field && SENSITIVE_FIELDS.has(a.field)
      ? { ...a, oldValue: "Restricted", newValue: "Restricted" }
      : a.field && LIST_FIELDS.has(a.field)
        ? { ...a, oldValue: label(a.oldValue), newValue: label(a.newValue) }
        : a,
  );

  return {
    member: m,
    photoDocId: photo?.id ?? null,
    events,
    documents,
    consent,
    audit: auditRows.map((a) => ({ ...a, id: a.id.toString() })),
    auditTotal,
    auditPage,
    lastChange,
    openFlags,
    mergedInto,
    caps: {
      edit: canOnMember(ctx, "member", "update", row),
      editProfile: canOnMember(ctx, "member.profile", "update", row),
      editSensitive: canOnMember(ctx, "member.sensitive", "update", row),
      manageMinistry: canOnMember(ctx, "member", "update", row) || can(ctx, "ministry", "manage"),
      statusRequest: can(ctx, "status_request", "create"),
      uploadDocs: canOnMember(ctx, "document", "upload", row),
      docs: docsAllowed,
      audit: auditAllowed,
      sensitive,
      profile,
      contact: canOnMember(ctx, "member.contact", "read", row),
      restore: can(ctx, "member", "restore"),
      del: canOnMember(ctx, "member", "delete", row),
    },
  };
}

export type MemberProfile = NonNullable<Awaited<ReturnType<typeof getMemberProfile>>>;
