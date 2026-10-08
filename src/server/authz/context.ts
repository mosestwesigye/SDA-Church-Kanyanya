import type { DbOrTx } from "../db";
import { REQUIRE_2FA, type RoleKey, type Scope } from "./catalog";
import { buildGrantMap, type AuthContext } from "./policy";

/** Load roles, grants and ministry scope for a user from the database. */
export async function loadAuthContext(
  db: DbOrTx,
  userId: string,
  extra: { sessionId?: string | null; ipAddress?: string | null } = {},
): Promise<AuthContext & { requires2fa: boolean; twoFactorEnabled: boolean; active: boolean }> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      roles: { include: { role: { include: { permissions: true } } } },
      ministryScopes: { select: { ministryId: true } },
    },
  });
  const roles = user.roles.map((r) => r.role.key as RoleKey);
  const grants = buildGrantMap(
    user.roles.flatMap((r) => r.role.permissions.map((p) => ({ resource: p.resource, action: p.action, scope: p.scope as Scope }))),
  );
  return {
    userId: user.id,
    label: user.name,
    roles,
    grants,
    ministryIds: user.ministryScopes.map((s) => s.ministryId),
    memberId: user.memberId,
    sessionId: extra.sessionId ?? null,
    ipAddress: extra.ipAddress ?? null,
    requires2fa: roles.some((r) => REQUIRE_2FA.includes(r)),
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    active: user.active,
  };
}
