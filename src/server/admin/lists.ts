import { z } from "zod";
import type { ListType } from "@/generated/prisma/client";
import { assertCan, type AuthContext } from "../authz/policy";
import { AuditWriter } from "../audit/audit";
import type { Db, DbOrTx } from "../db";
import { NotFoundError, ValidationError } from "../errors";
import { actorFrom } from "../members/service";

export const LIST_TYPES: { type: ListType; label: string }[] = [
  { type: "ZONE", label: "Zones" },
  { type: "MINISTRY", label: "Ministries" },
  { type: "MINISTRY_ROLE", label: "Ministry roles" },
  { type: "PROFESSION", label: "Professions" },
];

const labelSchema = z.string().trim().min(2, "Enter a name").max(60, "Keep it under 60 characters");

/** Items of one controlled list with how many live members use each. */
export async function listItemsForAdmin(db: DbOrTx, ctx: AuthContext, type: ListType) {
  assertCan(ctx, "admin.lists", "manage");
  const items = await db.listItem.findMany({ where: { type, mergedIntoId: null }, orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { label: "asc" }] });
  const live = { deletedAt: null, mergedIntoId: null, purgedAt: null };
  const ids = items.map((i) => i.id);
  const counts =
    type === "ZONE"
      ? await db.member.groupBy({ by: ["zoneId"], where: { ...live, zoneId: { in: ids } }, _count: true }).then((r) => r.map((x) => [x.zoneId, x._count] as const))
      : type === "PROFESSION"
        ? await db.member.groupBy({ by: ["professionId"], where: { ...live, professionId: { in: ids } }, _count: true }).then((r) => r.map((x) => [x.professionId, x._count] as const))
        : type === "MINISTRY"
          ? await db.memberMinistry.groupBy({ by: ["ministryId"], where: { ministryId: { in: ids }, member: live }, _count: true }).then((r) => r.map((x) => [x.ministryId, x._count] as const))
          : await db.memberMinistry.groupBy({ by: ["roleId"], where: { roleId: { in: ids }, member: live }, _count: true }).then((r) => r.map((x) => [x.roleId, x._count] as const));
  const byId = new Map(counts);
  return items.map((i) => ({ id: i.id, label: i.label, active: i.active, sortOrder: i.sortOrder, used: byId.get(i.id) ?? 0 }));
}

export async function addListItem(db: Db, ctx: AuthContext, type: ListType, label: string) {
  assertCan(ctx, "admin.lists", "manage");
  const name = labelSchema.parse(label);
  return db.$transaction(async (tx) => {
    const clash = await tx.listItem.findFirst({ where: { type, label: { equals: name, mode: "insensitive" } } });
    if (clash) throw new ValidationError(clash.active ? "That item already exists." : "That item exists but is hidden — show it again instead.", { label: "Already exists" });
    const max = await tx.listItem.aggregate({ where: { type }, _max: { sortOrder: true } });
    const item = await tx.listItem.create({ data: { type, label: name, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "CREATE", entity: "ListItem", entityId: item.id, newValue: { type, label: name } });
    return item;
  });
}

/** Rename an item. Every member using it shows the new name (the link is by ID). */
export async function renameListItem(db: Db, ctx: AuthContext, id: string, label: string) {
  assertCan(ctx, "admin.lists", "manage");
  const name = labelSchema.parse(label);
  await db.$transaction(async (tx) => {
    const item = await tx.listItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundError("Item not found.");
    if (item.label === name) return;
    const clash = await tx.listItem.findFirst({ where: { type: item.type, label: { equals: name, mode: "insensitive" }, id: { not: id } } });
    if (clash) throw new ValidationError("Another item already has that name.", { label: "Already exists" });
    await tx.listItem.update({ where: { id }, data: { label: name } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "UPDATE", entity: "ListItem", entityId: id, field: "label", oldValue: item.label, newValue: name });
  });
}

/** Hide an item from pickers (members keep it) or show it again. */
export async function setListItemActive(db: Db, ctx: AuthContext, id: string, active: boolean) {
  assertCan(ctx, "admin.lists", "manage");
  await db.$transaction(async (tx) => {
    const item = await tx.listItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundError("Item not found.");
    if (item.active === active) return;
    await tx.listItem.update({ where: { id }, data: { active } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "UPDATE", entity: "ListItem", entityId: id, field: "active", oldValue: item.active, newValue: active, note: item.label });
  });
}
