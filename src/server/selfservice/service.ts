import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { formatDob } from "@/lib/dob";
import { GENDER_LABELS, MARITAL_LABELS } from "@/lib/labels";
import { normalizeUgPhone } from "@/lib/phone";
import { assertCan, canOnMember, memberScopeWhere, memberSelect, projectMember, type AuthContext } from "../authz/policy";
import { AuditWriter, SYSTEM_ACTOR } from "../audit/audit";
import type { Db, DbOrTx } from "../db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { actorFrom, memberPatchSchema, patchToColumns, updateMemberInTx, type MemberPatch } from "../members/service";

// ───────── Sign-in provisioning ─────────

const LIVE = { deletedAt: null, mergedIntoId: null, purgedAt: null } as const;

/**
 * Prepare a phone sign-in. Returns the E.164 number to send a code to, or
 * null when the number can't be used (not in the register, shared by several
 * members, deceased, or linked to a staff login). Callers must show the same
 * message either way so the register can't be probed.
 */
export async function provisionMemberLogin(db: Db, phoneInput: string): Promise<string | null> {
  const phone = normalizeUgPhone(phoneInput);
  if (!phone?.valid || !phone.e164) return null;
  const e164 = phone.e164;

  const existing = await db.user.findUnique({ where: { phoneNumber: e164 }, include: { roles: { include: { role: true } }, member: true } });
  if (existing) {
    const stillTheirs = existing.member && existing.member.phoneE164 === e164 && !existing.member.deletedAt && !existing.member.purgedAt && existing.member.status !== "DECEASED";
    return existing.active && stillTheirs ? e164 : null;
  }

  const members = await db.member.findMany({
    where: { ...LIVE, phoneE164: e164, OR: [{ status: null }, { status: { not: "DECEASED" } }] },
    include: { user: { include: { roles: { include: { role: true } } } } },
    take: 2,
  });
  if (members.length !== 1) return null;
  const m = members[0]!;

  return db.$transaction(async (tx) => {
    const audit = new AuditWriter(tx, { ...SYSTEM_ACTOR, label: "Self-service sign-in" }, "SELF_SERVICE");
    if (m.user) {
      // Phone changed on the record: move the member login to the new number. Staff logins keep using email.
      const memberOnly = m.user.roles.every((r) => r.role.key === "MEMBER");
      if (!memberOnly || !m.user.active) return null;
      await tx.user.update({ where: { id: m.user.id }, data: { phoneNumber: e164, phoneNumberVerified: false } });
      await audit.log({ action: "UPDATE", entity: "User", entityId: m.user.id, memberId: m.id, field: "phoneNumber", note: "Updated from the member record" });
      return e164;
    }
    const role = await tx.role.findUniqueOrThrow({ where: { key: "MEMBER" } });
    const user = await tx.user.create({
      data: {
        name: `${m.firstName} ${m.lastName}`.trim(),
        email: `member-${m.memberNo}@members.sdak.invalid`,
        phoneNumber: e164,
        phoneNumberVerified: false,
        memberId: m.id,
        roles: { create: [{ roleId: role.id }] },
      },
    });
    await audit.log({ action: "CREATE", entity: "User", entityId: user.id, memberId: m.id, newValue: { roles: ["MEMBER"] }, note: "Member self-service login created at first sign-in" });
    return e164;
  });
}

// ───────── Consent (Data Protection and Privacy Act, 2019) ─────────

export async function consentVersion(db: DbOrTx): Promise<string> {
  const s = await db.appSetting.findUnique({ where: { key: "privacy.consentVersion" } });
  return typeof s?.value === "string" ? s.value : "2026-1";
}

export async function hasCurrentConsent(db: DbOrTx, memberId: string): Promise<boolean> {
  const version = await consentVersion(db);
  return (await db.consent.count({ where: { memberId, version, withdrawnAt: null } })) > 0;
}

function ownMemberId(ctx: AuthContext): string {
  if (!ctx.memberId) throw new ForbiddenError("This login isn’t linked to a member record.");
  return ctx.memberId;
}

export async function recordSelfServiceConsent(db: Db, ctx: AuthContext) {
  const memberId = ownMemberId(ctx);
  await db.$transaction(async (tx) => {
    const version = await consentVersion(tx);
    if (await tx.consent.count({ where: { memberId, version, withdrawnAt: null } })) return;
    const c = await tx.consent.create({ data: { memberId, version, method: "SELF_SERVICE", consentedAt: new Date(), recordedById: ctx.userId } });
    await new AuditWriter(tx, actorFrom(ctx), "SELF_SERVICE").log({ action: "CREATE", entity: "Consent", entityId: c.id, memberId, newValue: { version, method: "SELF_SERVICE" } });
  });
}

// ───────── Own record ─────────

export async function getOwnRecord(db: DbOrTx, ctx: AuthContext) {
  const memberId = ownMemberId(ctx);
  const row = await db.member.findFirst({
    where: { AND: [memberScopeWhere(ctx) as Prisma.MemberWhereInput, { id: memberId }, LIVE] },
    select: memberSelect(ctx) as Prisma.MemberSelect,
  });
  if (!row) throw new NotFoundError("Your record wasn’t found. Please speak to the church clerk.");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return projectMember(ctx, row as any) as Record<string, any> & { id: string; memberId: string; restricted: string[] };
}

// ───────── Correction requests ─────────

/** Fields a member may ask to correct (status, ID and spouse links stay with the clerk). */
export const CORRECTABLE = ["lastName", "firstName", "gender", "dobDate", "yearJoined", "zoneId", "phone", "email", "maritalStatus", "professionId", "nextOfKinName", "nextOfKinPhone"] as const;
export type CorrectableField = (typeof CORRECTABLE)[number];

export const FIELD_LABELS: Record<CorrectableField, string> = {
  lastName: "Last name",
  firstName: "First name",
  gender: "Gender",
  dobDate: "Date of birth",
  yearJoined: "Year joined",
  zoneId: "Zone",
  phone: "Phone",
  email: "Email",
  maritalStatus: "Marital status",
  professionId: "Profession",
  nextOfKinName: "Next of kin",
  nextOfKinPhone: "Next of kin phone",
};

export type Change = { label: string; from: string; to: string; value: unknown; applied?: boolean };

const correctionInput = z.object({ note: z.string().trim().max(500).optional() }).catchall(z.unknown());

/** Current value of a correctable field, for display. */
async function display(db: DbOrTx, field: CorrectableField, m: Record<string, unknown>): Promise<string> {
  const v = (k: string) => m[k];
  switch (field) {
    case "gender":
      return v("gender") ? GENDER_LABELS[v("gender") as "MALE"] : "";
    case "dobDate":
      return formatDob(v("dobPrecision") as "FULL", v("dobDate") as Date | null, v("dobYear") as number | null) ?? "";
    case "zoneId":
    case "professionId": {
      const id = v(field) as string | null;
      return id ? ((await db.listItem.findUnique({ where: { id } }))?.label ?? "") : "";
    }
    case "phone":
      return (v("phoneRaw") as string) ?? "";
    case "nextOfKinPhone":
      return (v("nextOfKinPhoneRaw") as string) ?? "";
    case "maritalStatus":
      return v("maritalStatus") ? MARITAL_LABELS[v("maritalStatus") as "SINGLE"] : "";
    default:
      return v(field) === null || v(field) === undefined ? "" : String(v(field));
  }
}

/** A member asks the clerk to correct their record. Nothing changes until a reviewer approves. */
export async function createCorrectionRequest(db: Db, ctx: AuthContext, input: Record<string, unknown>) {
  assertCan(ctx, "correction_request", "create");
  const memberId = ownMemberId(ctx);
  const { note, ...rest } = correctionInput.parse(input);
  const picked = Object.fromEntries(Object.entries(rest).filter(([k]) => (CORRECTABLE as readonly string[]).includes(k)));
  for (const [k, v] of Object.entries(picked)) if (v === "") picked[k] = null;
  const patch: MemberPatch = memberPatchSchema.parse(picked);
  if (patch.dobDate) patch.dobPrecision = "FULL";
  const columns = patchToColumns(patch); // validates phones / DOB

  return db.$transaction(async (tx) => {
    const m = await tx.member.findUnique({ where: { id: memberId }, include: { ministries: { select: { ministryId: true } } } });
    if (!m || m.deletedAt || m.purgedAt) throw new NotFoundError("Your record wasn’t found.");
    if (!canOnMember(ctx, "correction_request", "create", m)) throw new ForbiddenError();
    if (await tx.correctionRequest.count({ where: { memberId, state: "PENDING" } })) {
      throw new ConflictError("You already have a request waiting for the clerk. You can cancel it and send a new one.");
    }
    if (patch.zoneId && !(await tx.listItem.findFirst({ where: { id: patch.zoneId, type: "ZONE", active: true } }))) throw new ValidationError("Choose a zone from the list.");
    if (patch.professionId && !(await tx.listItem.findFirst({ where: { id: patch.professionId, type: "PROFESSION", active: true } }))) throw new ValidationError("Choose a profession from the list.");

    const current = m as unknown as Record<string, unknown>;
    const after = { ...current, ...columns };
    const changes: Record<string, Change> = {};
    for (const f of Object.keys(picked) as CorrectableField[]) {
      const [from, to] = [await display(tx, f, current), await display(tx, f, after)];
      if (from !== to) changes[f] = { label: FIELD_LABELS[f], from, to, value: patch[f as keyof MemberPatch] ?? null };
    }
    if (Object.keys(changes).length === 0) throw new ValidationError("Nothing has changed — edit at least one field.");

    const req = await tx.correctionRequest.create({ data: { memberId, submittedById: ctx.userId, changes: changes as Prisma.InputJsonValue, note: note || null } });
    await new AuditWriter(tx, actorFrom(ctx), "SELF_SERVICE").log({
      action: "CREATE",
      entity: "CorrectionRequest",
      entityId: req.id,
      memberId,
      newValue: { fields: Object.keys(changes) },
    });
    return req;
  });
}

export async function cancelOwnCorrectionRequest(db: Db, ctx: AuthContext, id: string) {
  const memberId = ownMemberId(ctx);
  await db.$transaction(async (tx) => {
    const req = await tx.correctionRequest.findFirst({ where: { id, memberId, state: "PENDING" } });
    if (!req) throw new NotFoundError("Request not found.");
    await tx.correctionRequest.update({ where: { id }, data: { state: "CANCELLED" } });
    await new AuditWriter(tx, actorFrom(ctx), "SELF_SERVICE").log({ action: "UPDATE", entity: "CorrectionRequest", entityId: id, memberId, field: "state", oldValue: "PENDING", newValue: "CANCELLED" });
  });
}

export async function ownCorrectionRequests(db: DbOrTx, ctx: AuthContext) {
  const memberId = ownMemberId(ctx);
  return db.correctionRequest.findMany({ where: { memberId }, orderBy: { createdAt: "desc" }, take: 10 });
}

/** Review queue (clerks). Each request shows the member's current value next to the requested one. */
export async function correctionQueue(db: DbOrTx, ctx: AuthContext, state: "PENDING" | "DONE" = "PENDING") {
  assertCan(ctx, "correction_request", "review");
  const reqs = await db.correctionRequest.findMany({
    where: state === "PENDING" ? { state: "PENDING" } : { state: { in: ["APPROVED", "REJECTED"] } },
    orderBy: { createdAt: state === "PENDING" ? "asc" : "desc" },
    take: state === "PENDING" ? 100 : 30,
    include: { member: true },
  });
  const reviewers = new Map(
    (await db.user.findMany({ where: { id: { in: reqs.map((r) => r.reviewedById).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );
  return Promise.all(
    reqs.map(async (r) => {
      const changes = r.changes as Record<string, Change>;
      const rows = await Promise.all(
        (Object.keys(changes) as CorrectableField[]).map(async (f) => ({
          field: f,
          ...changes[f]!,
          now: await display(db, f, r.member as unknown as Record<string, unknown>),
        })),
      );
      return {
        id: r.id,
        state: r.state,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
        reviewer: r.reviewedById ? (reviewers.get(r.reviewedById) ?? "—") : null,
        reviewNote: r.reviewNote,
        note: r.note,
        member: { id: r.member.id, memberId: r.member.memberId, name: `${r.member.lastName}, ${r.member.firstName}` },
        rows,
      };
    }),
  );
}

/**
 * Approve (all or some fields) or reject. Approved fields are written through
 * the audited member service in the same transaction as the decision.
 */
export async function decideCorrectionRequest(db: Db, ctx: AuthContext, id: string, decision: { approve: boolean; fields?: string[]; note?: string }) {
  assertCan(ctx, "correction_request", "review");
  return db.$transaction(async (tx) => {
    const req = await tx.correctionRequest.findUnique({ where: { id } });
    if (!req || req.state !== "PENDING") throw new NotFoundError("This request has already been dealt with.");
    if (req.submittedById === ctx.userId) throw new ForbiddenError("You can’t review your own request.");
    const changes = req.changes as Record<string, Change>;
    const chosen = decision.approve ? (decision.fields?.length ? decision.fields : Object.keys(changes)).filter((f) => f in changes) : [];
    if (decision.approve && chosen.length === 0) throw new ValidationError("Choose at least one change to approve.");
    const note = decision.note?.trim() || null;
    if (!decision.approve && !note) throw new ValidationError("Say why the request is rejected — the member will see this.", { note: "Required" });

    const audit = new AuditWriter(tx, actorFrom(ctx), "SELF_SERVICE");
    if (chosen.length) {
      const patch: Record<string, unknown> = Object.fromEntries(chosen.map((f) => [f, changes[f]!.value]));
      if ("dobDate" in patch) patch.dobPrecision = patch.dobDate ? "FULL" : "UNKNOWN";
      await updateMemberInTx(tx, ctx, req.memberId, patch, { source: "SELF_SERVICE", note: "Correction requested by the member", correlationId: audit.correlationId });
    }
    const marked = Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, { ...c, applied: chosen.includes(k) }]));
    await tx.correctionRequest.update({
      where: { id },
      data: { state: chosen.length ? "APPROVED" : "REJECTED", reviewedById: ctx.userId, reviewedAt: new Date(), reviewNote: note, changes: marked as Prisma.InputJsonValue },
    });
    await audit.log({
      action: chosen.length ? "APPROVE" : "REJECT",
      entity: "CorrectionRequest",
      entityId: id,
      memberId: req.memberId,
      newValue: { applied: chosen, declined: Object.keys(changes).filter((k) => !chosen.includes(k)) },
      note,
    });
    return { applied: chosen };
  });
}
