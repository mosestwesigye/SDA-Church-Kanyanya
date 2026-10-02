import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AuditWriter } from "../audit/audit";
import { assertCan, canOnMember, type AuthContext } from "../authz/policy";
import type { Db, Tx } from "../db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { actorFrom, refreshCompleteness } from "../members/service";

/** Field groups a clerk chooses between when merging (each moves as a unit). */
export const MERGE_FIELDS = {
  lastName: ["lastName"],
  firstName: ["firstName"],
  gender: ["gender"],
  dob: ["dobPrecision", "dobDate", "dobYear"],
  yearJoined: ["yearJoined"],
  photo: ["photoKey"],
  zone: ["zoneId"],
  phone: ["phoneRaw", "phoneE164"],
  email: ["email"],
  status: ["status"],
  maritalStatus: ["maritalStatus"],
  spouse: ["spouseMemberId", "spouseName"],
  nextOfKin: ["nextOfKinName", "nextOfKinPhoneRaw", "nextOfKinPhoneE164"],
  profession: ["professionId"],
} as const;
export type MergeField = keyof typeof MERGE_FIELDS;
const ALL_COLUMNS = Object.values(MERGE_FIELDS).flat();

export const mergeInput = z.object({
  survivorId: z.string(),
  retiredId: z.string(),
  choices: z.record(z.string(), z.enum(["survivor", "retired"])).default({}),
});

const empty = (v: unknown) => v === null || v === undefined || v === "" || (v as string) === "UNKNOWN";

/** Default choice per field: keep the survivor's value unless it's empty and the other has one. */
export function defaultChoices(survivor: Record<string, unknown>, retired: Record<string, unknown>): Record<MergeField, "survivor" | "retired"> {
  const out = {} as Record<MergeField, "survivor" | "retired">;
  for (const [f, cols] of Object.entries(MERGE_FIELDS) as [MergeField, readonly string[]][]) {
    const sEmpty = cols.every((c) => empty(survivor[c]));
    const rEmpty = cols.every((c) => empty(retired[c]));
    out[f] = sEmpty && !rEmpty ? "retired" : "survivor";
  }
  return out;
}

/** Child tables re-pointed from the retired record to the survivor (and back on undo). */
const RELINK = ["memberMinistry", "document", "consent", "membershipEvent", "rawValue", "reviewFlag", "statusChangeRequest", "transfer", "correctionRequest", "importRow"] as const;
type RelinkTable = (typeof RELINK)[number];

type Snapshot = {
  survivorBefore: Record<string, unknown>;
  survivorAfter: Record<string, unknown>;
  retiredBefore: { deletedAt: string | null };
  moved: Partial<Record<RelinkTable, string[]>>;
  droppedDuplicateLinks: { table: "memberMinistry" | "rawValue"; row: Record<string, unknown> }[];
  householdMoved: string[];
  spouseRefs: string[];
  userId: string | null;
};

function pick(row: Record<string, unknown>, cols: readonly string[]) {
  return Object.fromEntries(cols.map((c) => [c, row[c] instanceof Date ? (row[c] as Date).toISOString() : row[c]]));
}

function revive(values: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...values };
  if (typeof out.dobDate === "string") out.dobDate = new Date(out.dobDate as string);
  return out;
}

export async function mergeMembers(db: Db, ctx: AuthContext, input: z.input<typeof mergeInput>) {
  const { survivorId, retiredId, choices } = mergeInput.parse(input);
  if (survivorId === retiredId) throw new ValidationError("Choose two different records.");
  assertCan(ctx, "member", "merge");
  const undoDays = Number((await db.appSetting.findUnique({ where: { key: "merge.undoDays" } }))?.value ?? 30);

  return db.$transaction(async (tx) => {
    const [s, r] = await Promise.all([
      tx.member.findUnique({ where: { id: survivorId }, include: { ministries: { select: { ministryId: true } } } }),
      tx.member.findUnique({ where: { id: retiredId }, include: { ministries: { select: { ministryId: true } } } }),
    ]);
    if (!s || !r) throw new NotFoundError("Member not found.");
    for (const m of [s, r]) {
      if (m.mergedIntoId || m.purgedAt) throw new ValidationError(`${m.memberId} was already merged or purged.`);
      if (!canOnMember(ctx, "member", "merge", m)) throw new ForbiddenError();
    }

    // 1. Field values chosen from the retired record.
    const data: Record<string, unknown> = {};
    for (const [f, cols] of Object.entries(MERGE_FIELDS) as [MergeField, readonly string[]][]) {
      if (choices[f] === "retired") for (const c of cols) data[c] = (r as Record<string, unknown>)[c];
    }
    if (data.spouseMemberId === survivorId) data.spouseMemberId = null;
    const audit = new AuditWriter(tx, actorFrom(ctx), "MERGE");
    const survivorBefore = pick(s as Record<string, unknown>, ALL_COLUMNS);
    await audit.logChanges("Member", s.id, s as Record<string, unknown>, data, { memberId: s.id, note: `Merged from ${r.memberId}` });
    if (Object.keys(data).length) await tx.member.update({ where: { id: s.id }, data: { ...(data as Prisma.MemberUncheckedUpdateInput), version: { increment: 1 } } });

    // 2. Move child rows, dropping exact duplicates (same ministry+role, same raw value).
    const moved: Snapshot["moved"] = {};
    const dropped: Snapshot["droppedDuplicateLinks"] = [];
    const sLinks = new Set((await tx.memberMinistry.findMany({ where: { memberId: s.id } })).map((l) => `${l.ministryId}:${l.roleId}`));
    for (const l of await tx.memberMinistry.findMany({ where: { memberId: r.id } })) {
      if (sLinks.has(`${l.ministryId}:${l.roleId}`)) {
        dropped.push({ table: "memberMinistry", row: { ...l, since: l.since?.toISOString() ?? null, createdAt: l.createdAt.toISOString() } });
        await tx.memberMinistry.delete({ where: { id: l.id } });
      }
    }
    const sRaw = new Set((await tx.rawValue.findMany({ where: { memberId: s.id } })).map((v) => `${v.field}:${v.rawValue}`));
    for (const v of await tx.rawValue.findMany({ where: { memberId: r.id } })) {
      if (sRaw.has(`${v.field}:${v.rawValue}`)) {
        dropped.push({ table: "rawValue", row: { ...v, createdAt: v.createdAt.toISOString(), resolvedAt: v.resolvedAt?.toISOString() ?? null } });
        await tx.rawValue.delete({ where: { id: v.id } });
      }
    }
    for (const t of RELINK) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = (tx as any)[t];
      const rows: { id: string }[] = await model.findMany({ where: { memberId: r.id }, select: { id: true } });
      if (rows.length) {
        await model.updateMany({ where: { id: { in: rows.map((x) => x.id) } }, data: { memberId: s.id } });
        moved[t] = rows.map((x) => x.id);
      }
    }
    // Households: move membership unless the survivor is already in that household.
    const householdMoved: string[] = [];
    for (const h of await tx.householdMember.findMany({ where: { memberId: r.id } })) {
      const exists = await tx.householdMember.findUnique({ where: { householdId_memberId: { householdId: h.householdId, memberId: s.id } } });
      if (!exists) {
        await tx.householdMember.update({ where: { householdId_memberId: { householdId: h.householdId, memberId: r.id } }, data: { memberId: s.id } });
        householdMoved.push(h.householdId);
      }
    }
    // Other members whose spouse was the retired record now point to the survivor.
    const spouseRefs = (await tx.member.findMany({ where: { spouseMemberId: r.id, id: { not: s.id } }, select: { id: true } })).map((x) => x.id);
    if (spouseRefs.length) await tx.member.updateMany({ where: { id: { in: spouseRefs } }, data: { spouseMemberId: s.id } });
    // A self-service login follows the person.
    const user = await tx.user.findUnique({ where: { memberId: r.id }, select: { id: true } });
    if (user && !(await tx.user.findUnique({ where: { memberId: s.id } }))) await tx.user.update({ where: { id: user.id }, data: { memberId: s.id } });

    // 3. Retire the other ID (kept forever, never reused).
    await tx.member.update({ where: { id: r.id }, data: { mergedIntoId: s.id, version: { increment: 1 } } });
    await tx.membershipEvent.create({
      data: { memberId: s.id, type: "MERGE", title: `Merged duplicate ${r.memberId} into this record`, occurredOn: new Date(), createdById: ctx.userId },
    });
    await refreshCompleteness(tx, s.id);

    const after = await tx.member.findUniqueOrThrow({ where: { id: s.id } });
    const snapshot: Snapshot = {
      survivorBefore,
      survivorAfter: pick(after as Record<string, unknown>, ALL_COLUMNS),
      retiredBefore: { deletedAt: r.deletedAt?.toISOString() ?? null },
      moved,
      droppedDuplicateLinks: dropped,
      householdMoved,
      spouseRefs,
      userId: user?.id ?? null,
    };
    const merge = await tx.merge.create({
      data: {
        survivorId: s.id,
        retiredId: r.id,
        fieldChoices: choices,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        mergedById: ctx.userId,
        undoableUntil: new Date(Date.now() + undoDays * 86400_000),
      },
    });
    await audit.log(
      { action: "MERGE", entity: "Member", entityId: s.id, memberId: s.id, newValue: { retired: r.memberId, mergeId: merge.id } },
      { action: "MERGE", entity: "Member", entityId: r.id, memberId: r.id, field: "mergedIntoId", newValue: s.memberId, note: `Retired; merged into ${s.memberId}` },
    );
    return merge;
  });
}

/**
 * Undo a merge within its window. Survivor fields are restored only where
 * they still hold the merged value — later edits are kept and reported.
 */
export async function undoMerge(db: Db, ctx: AuthContext, mergeId: string) {
  assertCan(ctx, "member", "merge");
  return db.$transaction(async (tx: Tx) => {
    const merge = await tx.merge.findUnique({ where: { id: mergeId } });
    if (!merge) throw new NotFoundError("Merge not found.");
    if (merge.undoneAt) throw new ConflictError("This merge was already undone.");
    if (merge.undoableUntil < new Date()) throw new ValidationError("The 30-day window to undo this merge has passed.");
    const snap = merge.snapshot as unknown as Snapshot;
    const s = await tx.member.findUniqueOrThrow({ where: { id: merge.survivorId } });
    const r = await tx.member.findUniqueOrThrow({ where: { id: merge.retiredId } });

    const restore: Record<string, unknown> = {};
    const kept: string[] = [];
    const current = pick(s as Record<string, unknown>, ALL_COLUMNS);
    for (const [f, cols] of Object.entries(MERGE_FIELDS)) {
      const changedByMerge = cols.some((c) => JSON.stringify(snap.survivorBefore[c]) !== JSON.stringify(snap.survivorAfter[c]));
      if (!changedByMerge) continue;
      const untouchedSince = cols.every((c) => JSON.stringify(current[c]) === JSON.stringify(snap.survivorAfter[c]));
      if (untouchedSince) for (const c of cols) restore[c] = snap.survivorBefore[c];
      else kept.push(f);
    }
    const audit = new AuditWriter(tx, actorFrom(ctx), "MERGE");
    const revived = revive(restore);
    await audit.logChanges("Member", s.id, s as Record<string, unknown>, revived, { memberId: s.id, note: `Undo merge of ${r.memberId}` });
    if (Object.keys(revived).length) await tx.member.update({ where: { id: s.id }, data: { ...(revived as Prisma.MemberUncheckedUpdateInput), version: { increment: 1 } } });

    for (const [t, ids] of Object.entries(snap.moved) as [RelinkTable, string[]][]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any)[t].updateMany({ where: { id: { in: ids }, memberId: s.id }, data: { memberId: r.id } });
    }
    for (const d of snap.droppedDuplicateLinks) {
      if (d.table === "memberMinistry") {
        const row = d.row as { id: string; ministryId: string; roleId: string; since: string | null; createdAt: string };
        await tx.memberMinistry.create({ data: { id: row.id, memberId: r.id, ministryId: row.ministryId, roleId: row.roleId, since: row.since ? new Date(row.since) : null, createdAt: new Date(row.createdAt) } });
      } else {
        const row = d.row as { id: string; field: never; rawValue: string; normalized: string; importRowId: string | null; resolvedAt: string | null; resolvedById: string | null; createdAt: string };
        await tx.rawValue.create({ data: { ...row, memberId: r.id, resolvedAt: row.resolvedAt ? new Date(row.resolvedAt) : null, createdAt: new Date(row.createdAt) } });
      }
    }
    for (const hid of snap.householdMoved) {
      await tx.householdMember.updateMany({ where: { householdId: hid, memberId: s.id }, data: { memberId: r.id } });
    }
    if (snap.spouseRefs.length) await tx.member.updateMany({ where: { id: { in: snap.spouseRefs }, spouseMemberId: s.id }, data: { spouseMemberId: r.id } });
    if (snap.userId) await tx.user.updateMany({ where: { id: snap.userId, memberId: s.id }, data: { memberId: r.id } });

    await tx.member.update({ where: { id: r.id }, data: { mergedIntoId: null, version: { increment: 1 } } });
    await tx.membershipEvent.deleteMany({ where: { memberId: s.id, type: "MERGE", title: `Merged duplicate ${r.memberId} into this record` } });
    await tx.merge.update({ where: { id: merge.id }, data: { undoneAt: new Date(), undoneById: ctx.userId } });
    await refreshCompleteness(tx, s.id);
    await refreshCompleteness(tx, r.id);
    await audit.log(
      { action: "UNMERGE", entity: "Member", entityId: s.id, memberId: s.id, newValue: { restored: r.memberId, keptLaterEdits: kept } },
      { action: "UNMERGE", entity: "Member", entityId: r.id, memberId: r.id, field: "mergedIntoId", oldValue: s.memberId, note: "Merge undone; ID re-activated" },
    );
    return { keptLaterEdits: kept };
  });
}

/** "Not a duplicate": hide the pair from the queue (stored with ids ordered). */
export async function dismissDuplicate(db: Db, ctx: AuthContext, a: string, b: string) {
  assertCan(ctx, "cleanup", "use");
  const [memberAId, memberBId] = [a, b].sort();
  await db.duplicateDismissal.upsert({
    where: { memberAId_memberBId: { memberAId, memberBId } },
    create: { memberAId, memberBId, dismissedById: ctx.userId },
    update: {},
  });
  await new AuditWriter(db, actorFrom(ctx), "UI").log(
    { action: "UPDATE", entity: "DuplicateDismissal", entityId: `${memberAId}:${memberBId}`, memberId: memberAId, note: "Marked not a duplicate" },
    { action: "UPDATE", entity: "DuplicateDismissal", entityId: `${memberAId}:${memberBId}`, memberId: memberBId, note: "Marked not a duplicate" },
  );
}
