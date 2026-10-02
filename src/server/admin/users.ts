import type { RoleKey } from "../authz/catalog";
import { AuditWriter, type Actor } from "../audit/audit";
import type { Db } from "../db";
import { ValidationError } from "../errors";
import { hashPassword, passwordProblem } from "../auth/password";

export type NewStaffUser = {
  name: string;
  email: string;
  password: string;
  roles: RoleKey[];
  ministryIds?: string[];
  memberId?: string | null;
};

/**
 * Create a staff login with a credential account (the shape Better Auth
 * expects: providerId "credential", accountId = user id, argon2 hash).
 */
export async function createStaffUser(db: Db, actor: Actor, input: NewStaffUser) {
  const problem = passwordProblem(input.password);
  if (problem) throw new ValidationError(problem, { password: problem });
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);

  return db.$transaction(async (tx) => {
    const roles = await tx.role.findMany({ where: { key: { in: input.roles } } });
    if (roles.length !== input.roles.length) throw new ValidationError("Unknown role.");
    const user = await tx.user.create({
      data: {
        name: input.name.trim(),
        email,
        emailVerified: true,
        memberId: input.memberId ?? null,
        roles: { create: roles.map((r) => ({ roleId: r.id })) },
        ministryScopes: input.ministryIds?.length ? { create: input.ministryIds.map((ministryId) => ({ ministryId })) } : undefined,
      },
    });
    await tx.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: passwordHash } });
    await new AuditWriter(tx, actor, "UI").log({
      action: "CREATE",
      entity: "User",
      entityId: user.id,
      newValue: { name: user.name, email, roles: input.roles },
    });
    return user;
  });
}
