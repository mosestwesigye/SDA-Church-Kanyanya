import { z } from "zod";
import type { AuditAction, AuditSource, Prisma } from "@/generated/prisma/client";
import { fieldGroupOf } from "../authz/catalog";
import { can, scopeOf, type AuthContext } from "../authz/policy";
import type { DbOrTx } from "../db";
import { ForbiddenError } from "../errors";

export const AUDIT_PAGE = 50;

export const auditQuerySchema = z.object({
  actor: z.string().trim().max(80).optional().catch(undefined),
  action: z.string().optional().catch(undefined),
  entity: z.string().trim().max(40).optional().catch(undefined),
  member: z.string().trim().max(20).optional().catch(undefined), // SDAK/M0001, M1 or 1
  source: z.string().optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export function parseAuditQuery(sp: Record<string, string | string[] | undefined>): AuditQuery {
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v));
  return auditQuerySchema.parse(flat);
}

const ACTIONS: AuditAction[] = ["CREATE", "UPDATE", "DELETE", "RESTORE", "PURGE", "MERGE", "UNMERGE", "APPROVE", "REJECT", "LOGIN", "LOGIN_FAILED", "LOGOUT", "EXPORT", "SECURITY"];
const SOURCES: AuditSource[] = ["UI", "IMPORT", "SELF_SERVICE", "MERGE", "WORKFLOW", "SYSTEM"];
export const AUDIT_FILTERS = { actions: ACTIONS, sources: SOURCES };

/** Hide values from member field groups the viewer may not read (the fact of the change stays visible). */
function mask(ctx: AuthContext, field: string | null, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (field) {
    const g = fieldGroupOf(field);
    return g && g !== "member" && !can(ctx, g, "read") ? "•••" : value;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, mask(ctx, k, v)]));
  }
  return value;
}

/** Global audit trail (Admin → Audit log). Needs audit:read with ALL scope. */
export async function searchAudit(db: DbOrTx, ctx: AuthContext, q: AuditQuery) {
  if (scopeOf(ctx, "audit", "read") !== "ALL") throw new ForbiddenError("The full audit trail needs church-wide audit access.");
  const and: Prisma.AuditLogWhereInput[] = [];
  if (q.actor) and.push({ actorLabel: { contains: q.actor, mode: "insensitive" } });
  if (q.action && (ACTIONS as string[]).includes(q.action)) and.push({ action: q.action as AuditAction });
  if (q.source && (SOURCES as string[]).includes(q.source)) and.push({ source: q.source as AuditSource });
  if (q.entity) and.push({ entity: { equals: q.entity, mode: "insensitive" } });
  if (q.from) and.push({ at: { gte: new Date(`${q.from}T00:00:00+03:00`) } });
  if (q.to) and.push({ at: { lt: new Date(new Date(`${q.to}T00:00:00+03:00`).getTime() + 86400_000) } });
  if (q.member) {
    const n = q.member.toUpperCase().match(/(\d{1,6})$/);
    const m = n ? await db.member.findUnique({ where: { memberNo: Number(n[1]) }, select: { id: true } }) : null;
    and.push({ memberId: m?.id ?? "__none__" });
  }
  const where: Prisma.AuditLogWhereInput = { AND: and };
  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { id: "desc" }, skip: (q.page - 1) * AUDIT_PAGE, take: AUDIT_PAGE }),
  ]);
  const memberIds = [...new Set(rows.map((r) => r.memberId).filter((x): x is string => Boolean(x)))];
  const members = new Map(
    (await db.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, memberId: true } })).map((m) => [m.id, m.memberId]),
  );
  return {
    total,
    pages: Math.max(1, Math.ceil(total / AUDIT_PAGE)),
    rows: rows.map((r) => ({
      id: r.id.toString(),
      at: r.at,
      actor: r.actorLabel,
      source: r.source,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      member: r.memberId ? { id: r.memberId, memberId: members.get(r.memberId) ?? "—" } : null,
      field: r.field,
      oldValue: mask(ctx, r.field, r.oldValue),
      newValue: mask(ctx, r.field, r.newValue),
      ipAddress: r.ipAddress,
      note: r.note,
    })),
  };
}
