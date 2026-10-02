import { z } from "zod";
import type { AuditSource, Prisma } from "@/generated/prisma/client";
import { computeCompleteness } from "@/lib/completeness";
import { normalizeUgPhone } from "@/lib/phone";
import { AuditWriter, type Actor } from "../audit/audit";
import { assertCan, assertCanUpdateFields, canOnMember, type AuthContext } from "../authz/policy";
import type { Db, DbOrTx, Tx } from "../db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";

export function actorFrom(ctx: AuthContext): Actor {
  return { userId: ctx.userId, label: ctx.label, sessionId: ctx.sessionId, ipAddress: ctx.ipAddress };
}

const currentYear = () => new Date().getUTCFullYear();

/** Editable member fields (domain input; phones arrive raw and are normalised). */
export const memberPatchSchema = z
  .object({
    lastName: z.string().trim().min(1, "Last name is required").max(80),
    firstName: z.string().trim().min(1, "First name is required").max(80),
    gender: z.enum(["MALE", "FEMALE"]).nullable(),
    dobPrecision: z.enum(["FULL", "YEAR", "UNKNOWN"]),
    dobDate: z.iso.date().nullable(),
    dobYear: z.number().int().min(1900).max(currentYear()).nullable(),
    yearJoined: z.number().int().min(1900).max(currentYear()).nullable(),
    photoKey: z.string().max(300).nullable(),
    zoneId: z.string().nullable(),
    phone: z.string().trim().max(40).nullable(),
    email: z.email().max(120).nullable().or(z.literal("").transform(() => null)),
    status: z.enum(["ACTIVE", "IRREGULAR", "SELF_TRANSFERRED", "UNDER_DISCIPLINE", "DECEASED", "LEFT_THE_FAITH"]).nullable(),
    maritalStatus: z.enum(["SINGLE", "MARRIED", "SEPARATED", "COHABITING", "WIDOWED"]).nullable(),
    spouseMemberId: z.string().nullable(),
    spouseName: z.string().trim().max(120).nullable(),
    nextOfKinName: z.string().trim().max(120).nullable(),
    nextOfKinPhone: z.string().trim().max(40).nullable(),
    professionId: z.string().nullable(),
  })
  .partial();

export type MemberPatch = z.infer<typeof memberPatchSchema>;

/** Domain field → DB columns it writes (used for permission checks + audit keys). */
const COLUMNS: Record<keyof MemberPatch, string[]> = {
  lastName: ["lastName"],
  firstName: ["firstName"],
  gender: ["gender"],
  dobPrecision: ["dobPrecision"],
  dobDate: ["dobDate"],
  dobYear: ["dobYear"],
  yearJoined: ["yearJoined"],
  photoKey: ["photoKey"],
  zoneId: ["zoneId"],
  phone: ["phoneRaw", "phoneE164"],
  email: ["email"],
  status: ["status"],
  maritalStatus: ["maritalStatus"],
  spouseMemberId: ["spouseMemberId"],
  spouseName: ["spouseName"],
  nextOfKinName: ["nextOfKinName"],
  nextOfKinPhone: ["nextOfKinPhoneRaw", "nextOfKinPhoneE164"],
  professionId: ["professionId"],
};

/** Turn a validated patch into column values, normalising phones and DOB. */
export function patchToColumns(p: MemberPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const [k, v] of Object.entries(p) as [keyof MemberPatch, unknown][]) {
    if (v === undefined) continue;
    switch (k) {
      case "phone":
      case "nextOfKinPhone": {
        const raw = k === "phone" ? "phoneRaw" : "nextOfKinPhoneRaw";
        const e164 = k === "phone" ? "phoneE164" : "nextOfKinPhoneE164";
        const res = normalizeUgPhone(v);
        if (res && !res.valid) errors[k] = "Use 07XX XXX XXX";
        out[raw] = res?.display ?? null;
        out[e164] = res?.e164 ?? null;
        break;
      }
      case "dobDate":
        out.dobDate = v ? new Date(`${v}T00:00:00Z`) : null;
        break;
      default:
        out[k] = v;
    }
  }
  // Keep the DOB triple consistent.
  if ("dobPrecision" in p || "dobDate" in p || "dobYear" in p) {
    const precision = p.dobPrecision ?? (p.dobDate ? "FULL" : p.dobYear ? "YEAR" : "UNKNOWN");
    out.dobPrecision = precision;
    if (precision === "FULL") {
      if (!p.dobDate) errors.dobDate = "Enter the full date of birth";
      else out.dobYear = Number(p.dobDate.slice(0, 4));
    } else if (precision === "YEAR") {
      if (!p.dobYear) errors.dobYear = "Enter the year of birth";
      out.dobDate = null;
    } else {
      out.dobDate = null;
      out.dobYear = null;
    }
  }
  if (p.spouseMemberId) out.spouseName = null;
  if (Object.keys(errors).length) throw new ValidationError("Some fields need attention.", errors);
  return out;
}

const COMPLETENESS_SELECT = {
  lastName: true, firstName: true, gender: true, dobPrecision: true, yearJoined: true,
  photoKey: true, zoneId: true, phoneE164: true, status: true, maritalStatus: true,
  spouseMemberId: true, spouseName: true, nextOfKinName: true, nextOfKinPhoneE164: true,
  professionId: true, _count: { select: { ministries: true } },
} satisfies Prisma.MemberSelect;

/** Recompute and store completeness for one member (call after any write). */
export async function refreshCompleteness(tx: DbOrTx, memberId: string): Promise<{ percent: number; missing: string[] }> {
  const m = await tx.member.findUniqueOrThrow({ where: { id: memberId }, select: COMPLETENESS_SELECT });
  const res = computeCompleteness({ ...m, ministryCount: m._count.ministries });
  await tx.member.update({ where: { id: memberId }, data: { completeness: res.percent, missingFields: res.missing } });
  return res;
}

/** Status changes on a member who already has a status go through the approval workflow. */
function guardStatus(current: string | null, next: unknown) {
  if (next === undefined || next === current) return;
  if (current !== null) {
    throw new ValidationError("Status changes need approval. Use “Change status”.", {
      status: "Use Change status",
    });
  }
}

export type UpdateOptions = {
  /** Optimistic concurrency: reject if the record moved on. */
  expectedVersion?: number;
  source?: AuditSource;
  note?: string;
  correlationId?: string;
};

async function loadForWrite(tx: Tx, id: string) {
  const m = await tx.member.findUnique({
    where: { id },
    include: { ministries: { select: { ministryId: true } } },
  });
  if (!m || m.purgedAt) throw new NotFoundError("Member not found.");
  return m;
}

export async function updateMember(db: Db, ctx: AuthContext, id: string, input: unknown, opts: UpdateOptions = {}) {
  const patch = memberPatchSchema.parse(input);
  const fields = (Object.keys(patch) as (keyof MemberPatch)[]).filter((k) => patch[k] !== undefined);
  if (fields.length === 0) return { changes: [] };

  return db.$transaction(async (tx) => {
    const before = await loadForWrite(tx, id);
    if (before.deletedAt) throw new ValidationError("Restore this member before editing.");
    const columns = fields.flatMap((f) => COLUMNS[f]);
    assertCanUpdateFields(ctx, columns, before);
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== before.version) throw new ConflictError();
    guardStatus(before.status, patch.status);
    if (patch.spouseMemberId && patch.spouseMemberId === id) {
      throw new ValidationError("A member cannot be their own spouse.", { spouseMemberId: "Choose another member" });
    }

    const data = patchToColumns(patch);
    const audit = new AuditWriter(tx, actorFrom(ctx), opts.source ?? "UI", opts.correlationId);
    const changes = await audit.logChanges("Member", id, before as unknown as Record<string, unknown>, data, {
      memberId: id,
      note: opts.note,
    });
    if (changes.length === 0) return { changes };

    // Conditional on version so concurrent writers can't silently overwrite.
    const res = await tx.member.updateMany({
      where: { id, version: before.version },
      data: { ...(data as Prisma.MemberUpdateManyMutationInput), version: { increment: 1 } },
    });
    if (res.count !== 1) throw new ConflictError();
    await refreshCompleteness(tx, id);
    return { changes };
  });
}

export const memberCreateSchema = memberPatchSchema.required({ lastName: true, firstName: true });

export async function createMember(db: Db, ctx: AuthContext, input: unknown, opts: { source?: AuditSource; note?: string } = {}) {
  assertCan(ctx, "member", "create");
  const patch = memberCreateSchema.parse(input);
  const columns = (Object.keys(patch) as (keyof MemberPatch)[]).flatMap((f) => COLUMNS[f]);
  // Creating with sensitive/contact data needs those update rights too.
  assertCanUpdateFields(ctx, columns, { id: "__new__", ministries: [] });
  if (patch.status === undefined) patch.status = null;
  const data = patchToColumns(patch);

  return db.$transaction(async (tx) => {
    const m = await tx.member.create({ data: data as Prisma.MemberUncheckedCreateInput });
    const audit = new AuditWriter(tx, actorFrom(ctx), opts.source ?? "UI");
    await audit.log({ action: "CREATE", entity: "Member", entityId: m.id, memberId: m.id, newValue: { memberId: m.memberId, ...data }, note: opts.note });
    await refreshCompleteness(tx, m.id);
    return tx.member.findUniqueOrThrow({ where: { id: m.id } });
  });
}

export async function softDeleteMember(db: Db, ctx: AuthContext, id: string, reason: string) {
  return db.$transaction(async (tx) => {
    const m = await loadForWrite(tx, id);
    if (!canOnMember(ctx, "member", "delete", m)) throw new ForbiddenError();
    if (m.deletedAt) return m;
    const now = new Date();
    const updated = await tx.member.update({ where: { id }, data: { deletedAt: now, deletedById: ctx.userId, version: { increment: 1 } } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "DELETE", entity: "Member", entityId: id, memberId: id, field: "deletedAt", newValue: now, note: reason });
    return updated;
  });
}

export async function restoreMember(db: Db, ctx: AuthContext, id: string) {
  return db.$transaction(async (tx) => {
    const m = await loadForWrite(tx, id);
    if (!canOnMember(ctx, "member", "restore", m)) throw new ForbiddenError();
    if (!m.deletedAt) return m;
    const updated = await tx.member.update({ where: { id }, data: { deletedAt: null, deletedById: null, version: { increment: 1 } } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "RESTORE", entity: "Member", entityId: id, memberId: id, field: "deletedAt", oldValue: m.deletedAt });
    return updated;
  });
}

/** Add a ministry/role pair (audited, completeness refreshed). */
export async function addMinistry(db: Db, ctx: AuthContext, memberId: string, ministryId: string, roleId: string, source: AuditSource = "UI") {
  return db.$transaction(async (tx) => {
    const m = await loadForWrite(tx, memberId);
    const canManage = canOnMember(ctx, "member", "update", m) || canOnMember(ctx, "ministry", "manage", { id: m.id, ministries: [{ ministryId }] });
    if (!canManage) throw new ForbiddenError();
    const link = await tx.memberMinistry.upsert({
      where: { memberId_ministryId_roleId: { memberId, ministryId, roleId } },
      create: { memberId, ministryId, roleId },
      update: {},
      include: { ministry: true, role: true },
    });
    await new AuditWriter(tx, actorFrom(ctx), source).log({
      action: "CREATE", entity: "MemberMinistry", entityId: link.id, memberId, field: "ministry",
      newValue: `${link.ministry.label} · ${link.role.label}`,
    });
    await refreshCompleteness(tx, memberId);
    return link;
  });
}
