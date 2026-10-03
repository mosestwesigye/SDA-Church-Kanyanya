import type { Prisma } from "@/generated/prisma/client";
import { AuditWriter } from "../audit/audit";
import { assertCan, canOnMember, memberScopeWhere, memberSelect, projectMember, scopeOf, type AuthContext } from "../authz/policy";
import type { Db, DbOrTx } from "../db";
import { ForbiddenError, NotFoundError } from "../errors";
import { actorFrom, refreshCompleteness } from "../members/service";

const LEAD_ROLES = ["Head", "Assistant Head", "Chief Elder", "Coordinator"];

/** Ministries the caller may see (Ministry Heads: only their own), with leaders and counts. */
export async function listMinistries(db: DbOrTx, ctx: AuthContext) {
  const scope = assertCan(ctx, "ministry", "read");
  const where: Prisma.ListItemWhereInput = { type: "MINISTRY", active: true, mergedIntoId: null, ...(scope === "MINISTRY" ? { id: { in: ctx.ministryIds } } : {}) };
  const ministries = await db.listItem.findMany({ where, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
  const live = { deletedAt: null, mergedIntoId: null, purgedAt: null };
  const [counts, leaders] = await Promise.all([
    db.memberMinistry.groupBy({ by: ["ministryId"], where: { ministryId: { in: ministries.map((m) => m.id) }, member: live }, _count: { memberId: true } }),
    db.memberMinistry.findMany({
      where: { ministryId: { in: ministries.map((m) => m.id) }, role: { label: { in: LEAD_ROLES } }, member: live },
      select: { ministryId: true, role: { select: { label: true } }, member: { select: { id: true, lastName: true, firstName: true } } },
    }),
  ]);
  return ministries.map((m) => ({
    id: m.id,
    label: m.label,
    members: counts.find((c) => c.ministryId === m.id)?._count.memberId ?? 0,
    heads: leaders.filter((l) => l.ministryId === m.id && l.role.label !== "Assistant Head").map((l) => ({ id: l.member.id, name: `${l.member.firstName} ${l.member.lastName}`.trim(), role: l.role.label })),
    assistants: leaders.filter((l) => l.ministryId === m.id && l.role.label === "Assistant Head").map((l) => ({ id: l.member.id, name: `${l.member.firstName} ${l.member.lastName}`.trim() })),
  }));
}

function assertMinistryVisible(ctx: AuthContext, ministryId: string) {
  const scope = assertCan(ctx, "ministry", "read");
  if (scope === "MINISTRY" && !ctx.ministryIds.includes(ministryId)) throw new ForbiddenError();
}

/** Roster for one ministry, with the caller's field restrictions applied. */
export async function ministryRoster(db: DbOrTx, ctx: AuthContext, ministryId: string) {
  assertMinistryVisible(ctx, ministryId);
  const ministry = await db.listItem.findFirst({ where: { id: ministryId, type: "MINISTRY" } });
  if (!ministry) throw new NotFoundError("Ministry not found.");
  const links = await db.memberMinistry.findMany({
    where: { ministryId, member: { deletedAt: null, mergedIntoId: null, purgedAt: null } },
    include: { role: { select: { id: true, label: true, sortOrder: true } } },
  });
  const members = await db.member.findMany({
    where: { AND: [memberScopeWhere(ctx) as Prisma.MemberWhereInput, { id: { in: links.map((l) => l.memberId) } }] },
    select: memberSelect(ctx) as Prisma.MemberSelect,
  });
  const byId = new Map(members.map((m) => [m.id, projectMember(ctx, m as unknown as { id: string; ministries: { ministryId: string }[] } & Record<string, unknown>)]));
  const roster = links
    .filter((l) => byId.has(l.memberId))
    .map((l) => ({ linkId: l.id, roleId: l.roleId, role: l.role.label, roleOrder: l.role.sortOrder, since: l.since, member: byId.get(l.memberId)! }))
    .sort((a, b) => a.roleOrder - b.roleOrder || String(a.member.lastName).localeCompare(String(b.member.lastName)));
  const scope = scopeOf(ctx, "ministry", "manage");
  const canManage = scope === "ALL" || (scope === "MINISTRY" && ctx.ministryIds.includes(ministryId));
  return { ministry, roster, canManage };
}

/** Change a member's role within a ministry (audited). */
export async function setMinistryRole(db: Db, ctx: AuthContext, linkId: string, roleId: string) {
  return db.$transaction(async (tx) => {
    const link = await tx.memberMinistry.findUnique({ where: { id: linkId }, include: { ministry: true, role: true } });
    if (!link) throw new NotFoundError();
    const m = await tx.member.findUniqueOrThrow({ where: { id: link.memberId }, include: { ministries: { select: { ministryId: true } } } });
    const ok = canOnMember(ctx, "member", "update", m) || canOnMember(ctx, "ministry", "manage", { id: m.id, ministries: [{ ministryId: link.ministryId }] });
    if (!ok) throw new ForbiddenError();
    const role = await tx.listItem.findFirst({ where: { id: roleId, type: "MINISTRY_ROLE", active: true } });
    if (!role) throw new NotFoundError("Role not found.");
    if (role.id === link.roleId) return link;
    const clash = await tx.memberMinistry.findUnique({ where: { memberId_ministryId_roleId: { memberId: m.id, ministryId: link.ministryId, roleId } } });
    if (clash) {
      await tx.memberMinistry.delete({ where: { id: link.id } });
    } else {
      await tx.memberMinistry.update({ where: { id: link.id }, data: { roleId } });
    }
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({
      action: "UPDATE",
      entity: "MemberMinistry",
      entityId: link.id,
      memberId: m.id,
      field: "ministry",
      oldValue: `${link.ministry.label} · ${link.role.label}`,
      newValue: `${link.ministry.label} · ${role.label}`,
    });
    await refreshCompleteness(tx, m.id);
    return link;
  });
}
