import { z } from "zod";
import type { Prisma, RawValueField } from "@/generated/prisma/client";
import { AuditWriter } from "../audit/audit";
import { assertCan, can, canOnMember, memberScopeWhere, type AuthContext } from "../authz/policy";
import type { Db } from "../db";
import { ForbiddenError, ValidationError } from "../errors";
import { actorFrom, addMinistry, refreshCompleteness, updateMember } from "../members/service";
import { LIST_FIELDS } from "./queues";

export const mapInput = z.object({
  field: z.enum(["GENDER", "DOB", "YEAR_JOINED", "ZONE", "PHONE", "EMAIL", "STATUS", "MARITAL", "SPOUSE", "NEXT_OF_KIN", "PROFESSION", "MINISTRY", "MINISTRY_ROLE"]),
  normalized: z.array(z.string()).min(1).max(200),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("blank") }),
    z.object({ kind: z.literal("item"), id: z.string() }),
    z.object({ kind: z.literal("new"), label: z.string().trim().min(2).max(60) }),
  ]),
  remember: z.boolean().default(true),
});

/**
 * Bulk-map non-standard values to a canonical list value (or "not recorded").
 * Member fields are only filled when empty; every change goes through the
 * audited member service. Optionally remembers the mapping for future imports.
 */
export async function mapRawValues(db: Db, ctx: AuthContext, input: z.input<typeof mapInput>) {
  const { field, normalized, target, remember } = mapInput.parse(input);
  assertCan(ctx, "cleanup", "use");
  const listType = LIST_FIELDS[field];
  if (target.kind !== "blank" && !listType) throw new ValidationError("These values can only be cleared here; fix them on each record.");
  if (target.kind === "new" && !can(ctx, "admin.lists", "manage")) throw new ForbiddenError("Only an administrator can add list values.");

  // Resolve the target list item.
  let itemId: string | null = null;
  if (target.kind === "item") {
    const item = await db.listItem.findFirst({ where: { id: target.id, type: listType, active: true } });
    if (!item) throw new ValidationError("Choose a value from the list.");
    itemId = item.id;
  } else if (target.kind === "new") {
    const existing = await db.listItem.findUnique({ where: { type_label: { type: listType!, label: target.label } } });
    const item =
      existing ??
      (await db.listItem.create({
        data: { type: listType!, label: target.label, sortOrder: (await db.listItem.count({ where: { type: listType } })) + 1 },
      }));
    if (!existing) {
      await new AuditWriter(db, actorFrom(ctx), "UI").log({ action: "CREATE", entity: "ListItem", entityId: item.id, newValue: `${listType}: ${item.label}` });
    }
    itemId = item.id;
  }

  const raws = await db.rawValue.findMany({
    where: { field, normalized: { in: normalized }, resolvedAt: null, member: { AND: [memberScopeWhere(ctx) as Prisma.MemberWhereInput, { purgedAt: null }] } },
    include: { member: { select: { id: true, zoneId: true, professionId: true, deletedAt: true, mergedIntoId: true } } },
  });
  const memberRole = await db.listItem.findFirst({ where: { type: "MINISTRY_ROLE", label: "Member" } });
  let applied = 0;
  let resolved = 0;
  const problems: string[] = [];

  for (const raw of raws) {
    const note = `Mapped “${raw.rawValue}”`;
    try {
      if (itemId && !raw.member.deletedAt && !raw.member.mergedIntoId) {
        if (field === "ZONE" && !raw.member.zoneId) {
          await updateMember(db, ctx, raw.memberId, { zoneId: itemId }, { note });
          applied++;
        } else if (field === "PROFESSION" && !raw.member.professionId) {
          await updateMember(db, ctx, raw.memberId, { professionId: itemId }, { note });
          applied++;
        } else if (field === "MINISTRY" && memberRole) {
          await addMinistry(db, ctx, raw.memberId, itemId, memberRole.id);
          applied++;
        } else if (field === "MINISTRY_ROLE") {
          applied += (await setRoleOnOnlyLink(db, ctx, raw.memberId, itemId, note)) ? 1 : 0;
        }
      }
      await db.$transaction(async (tx) => {
        await tx.rawValue.update({ where: { id: raw.id }, data: { resolvedAt: new Date(), resolvedById: ctx.userId } });
        await new AuditWriter(tx, actorFrom(ctx), "UI").log({
          action: "UPDATE",
          entity: "RawValue",
          entityId: raw.id,
          memberId: raw.memberId,
          field: field.toLowerCase(),
          oldValue: raw.rawValue,
          newValue: target.kind === "blank" ? "Not recorded" : "mapped",
          note,
        });
      });
      resolved++;
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (remember && listType) {
    for (const n of normalized) {
      await db.valueMapping.upsert({
        where: { field_normalized: { field: field as RawValueField, normalized: n } },
        create: { field: field as RawValueField, normalized: n, listItemId: itemId, meansBlank: target.kind === "blank", createdById: ctx.userId },
        update: { listItemId: itemId, meansBlank: target.kind === "blank", createdById: ctx.userId },
      });
    }
  }
  return { resolved, applied, problems: [...new Set(problems)] };
}

/**
 * For a role value: if the member has exactly one ministry link (which the
 * importer created with the default "Member" role), set that link's role.
 */
async function setRoleOnOnlyLink(db: Db, ctx: AuthContext, memberId: string, roleId: string, note: string) {
  return db.$transaction(async (tx) => {
    const links = await tx.memberMinistry.findMany({ where: { memberId }, include: { ministry: true, role: true } });
    if (links.length !== 1 || links[0].roleId === roleId) return false;
    const m = await tx.member.findUniqueOrThrow({ where: { id: memberId }, include: { ministries: { select: { ministryId: true } } } });
    if (!canOnMember(ctx, "member", "update", m) && !canOnMember(ctx, "ministry", "manage", { id: m.id, ministries: [{ ministryId: links[0].ministryId }] })) {
      throw new ForbiddenError();
    }
    const role = await tx.listItem.findUniqueOrThrow({ where: { id: roleId } });
    await tx.memberMinistry.update({ where: { id: links[0].id }, data: { roleId } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({
      action: "UPDATE",
      entity: "MemberMinistry",
      entityId: links[0].id,
      memberId: m.id,
      field: "ministry",
      oldValue: `${links[0].ministry.label} · ${links[0].role.label}`,
      newValue: `${links[0].ministry.label} · ${role.label}`,
      note,
    });
    await refreshCompleteness(tx, memberId);
    return true;
  });
}

/** Mark a single raw value as handled (e.g. after fixing the record by hand). */
export async function dismissRawValue(db: Db, ctx: AuthContext, rawValueId: string) {
  assertCan(ctx, "cleanup", "use");
  const raw = await db.rawValue.findUniqueOrThrow({ where: { id: rawValueId } });
  await db.$transaction(async (tx) => {
    await tx.rawValue.update({ where: { id: raw.id }, data: { resolvedAt: new Date(), resolvedById: ctx.userId } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "UPDATE", entity: "RawValue", entityId: raw.id, memberId: raw.memberId, field: raw.field.toLowerCase(), oldValue: raw.rawValue, newValue: "dismissed" });
  });
}

export async function resolveFlag(db: Db, ctx: AuthContext, flagId: string) {
  assertCan(ctx, "cleanup", "use");
  const flag = await db.reviewFlag.findUniqueOrThrow({ where: { id: flagId } });
  if (flag.resolvedAt) return;
  await db.$transaction(async (tx) => {
    await tx.reviewFlag.update({ where: { id: flagId }, data: { resolvedAt: new Date(), resolvedById: ctx.userId } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "UPDATE", entity: "ReviewFlag", entityId: flagId, memberId: flag.memberId, oldValue: flag.reason, newValue: "resolved" });
  });
}

export async function setCleanupTarget(db: Db, ctx: AuthContext, targetPercent: number, dueDate: string) {
  assertCan(ctx, "admin.lists", "manage");
  const p = z.number().int().min(1).max(100).parse(targetPercent);
  const d = z.iso.date().parse(dueDate);
  const t = await db.cleanupTarget.create({ data: { targetPercent: p, dueDate: new Date(`${d}T00:00:00Z`), createdById: ctx.userId } });
  await new AuditWriter(db, actorFrom(ctx), "UI").log({ action: "UPDATE", entity: "CleanupTarget", entityId: t.id, newValue: { targetPercent: p, dueDate: d } });
  return t;
}
