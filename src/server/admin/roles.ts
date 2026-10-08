import { CATALOG, type Resource, type RoleKey, type Scope } from "../authz/catalog";
import { assertCan, type AuthContext } from "../authz/policy";
import { AuditWriter } from "../audit/audit";
import type { Db, DbOrTx } from "../db";
import { NotFoundError, ValidationError } from "../errors";
import { actorFrom } from "../members/service";

/** Grants an admin can never remove from System Admin (would lock everyone out of the matrix). */
const LOCKED: [RoleKey, Resource, string][] = [
  ["SYSTEM_ADMIN", "admin.roles", "manage"],
  ["SYSTEM_ADMIN", "admin.users", "manage"],
];

export const RESOURCE_LABELS: Record<Resource, string> = {
  member: "Member record (name, ID, ministries)",
  "member.profile": "Profile fields (DOB, zone, status…)",
  "member.contact": "Contact (phone, email)",
  "member.sensitive": "Sensitive (marital, spouse, next of kin)",
  ministry: "Ministries",
  household: "Families",
  cleanup: "Data clean-up",
  import: "Import",
  status_request: "Status changes",
  transfer: "Transfers",
  correction_request: "Self-service corrections",
  document: "Documents",
  report: "Reports",
  export: "Exports & downloads",
  audit: "Audit log",
  minutes: "Board minutes",
  "admin.users": "Admin: users",
  "admin.roles": "Admin: roles & permissions",
  "admin.lists": "Admin: lists & data rules",
  "admin.security": "Admin: security",
};

export async function permissionMatrix(db: DbOrTx, ctx: AuthContext) {
  assertCan(ctx, "admin.roles", "manage");
  const roles = await db.role.findMany({ include: { permissions: true, _count: { select: { users: true } } }, orderBy: { createdAt: "asc" } });
  return {
    roles: roles.map((r) => ({
      id: r.id,
      key: r.key as RoleKey,
      name: r.name,
      require2fa: r.require2fa,
      users: r._count.users,
      grants: Object.fromEntries(r.permissions.map((p) => [`${p.resource}:${p.action}`, p.scope as Scope])) as Record<string, Scope>,
    })),
    catalog: (Object.entries(CATALOG) as [Resource, readonly string[]][]).map(([resource, actions]) => ({ resource, label: RESOURCE_LABELS[resource], actions: [...actions] })),
    locked: LOCKED.map(([r, res, a]) => `${r}|${res}:${a}`),
  };
}

/** Grant (with a scope) or revoke one permission for a role. Audited; takes effect on the next request. */
export async function setPermission(db: Db, ctx: AuthContext, input: { roleId: string; resource: string; action: string; scope: Scope | null }) {
  assertCan(ctx, "admin.roles", "manage");
  const actions = CATALOG[input.resource as Resource] as readonly string[] | undefined;
  if (!actions?.includes(input.action)) throw new ValidationError("Unknown permission.");
  if (input.scope !== null && !["ALL", "MINISTRY", "SELF"].includes(input.scope)) throw new ValidationError("Unknown scope.");
  return db.$transaction(async (tx) => {
    const role = await tx.role.findUnique({ where: { id: input.roleId } });
    if (!role) throw new NotFoundError("Role not found.");
    if (LOCKED.some(([r, res, a]) => r === role.key && res === input.resource && a === input.action) && input.scope !== "ALL") {
      throw new ValidationError("System Admin must keep this permission, or nobody could manage access.");
    }
    const key = { roleId_resource_action: { roleId: role.id, resource: input.resource, action: input.action } };
    const before = await tx.permission.findUnique({ where: key });
    if ((before?.scope ?? null) === input.scope) return;
    if (input.scope === null) await tx.permission.delete({ where: key });
    else await tx.permission.upsert({ where: key, create: { roleId: role.id, resource: input.resource, action: input.action, scope: input.scope }, update: { scope: input.scope } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({
      action: "SECURITY",
      entity: "Permission",
      entityId: `${role.key}:${input.resource}:${input.action}`,
      oldValue: before?.scope ?? "none",
      newValue: input.scope ?? "none",
    });
  });
}
