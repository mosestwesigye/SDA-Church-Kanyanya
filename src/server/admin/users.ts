import { z } from "zod";
import { ROLE_KEYS, type RoleKey } from "../authz/catalog";
import { assertCan, type AuthContext } from "../authz/policy";
import { AuditWriter, type Actor } from "../audit/audit";
import type { Db, DbOrTx } from "../db";
import { NotFoundError, ValidationError } from "../errors";
import { actorFrom } from "../members/service";
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

// ───────── Administration (Admin → Users) ─────────

const lastAdminGuard = async (tx: DbOrTx, userId: string, losing: boolean) => {
  if (!losing) return;
  const admins = await tx.user.count({ where: { active: true, id: { not: userId }, roles: { some: { role: { key: "SYSTEM_ADMIN" } } } } });
  if (admins === 0) throw new ValidationError("This is the last active System Admin. Make someone else an admin first.");
};

export async function listUsers(db: DbOrTx, ctx: AuthContext) {
  assertCan(ctx, "admin.users", "manage");
  const users = await db.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: {
      roles: { include: { role: { select: { key: true, name: true } } } },
      ministryScopes: { include: { ministry: { select: { id: true, label: true } } } },
      member: { select: { id: true, memberId: true } },
      _count: { select: { sessions: { where: { expiresAt: { gt: new Date() } } } } },
    },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phoneNumber,
    active: u.active,
    twoFactorEnabled: Boolean(u.twoFactorEnabled),
    lastLoginAt: u.lastLoginAt,
    roles: u.roles.map((r) => r.role.key as RoleKey),
    ministries: u.ministryScopes.map((s) => s.ministry),
    member: u.member,
    activeSessions: u._count.sessions,
  }));
}

export const newUserInput = z.object({
  name: z.string().trim().min(2, "Enter the person’s name").max(80),
  email: z.email("Enter a valid email").max(120),
  password: z.string().min(1, "Set a first password"),
  roles: z.array(z.enum(ROLE_KEYS)).min(1, "Choose at least one role"),
  ministryIds: z.array(z.string()).optional(),
});

export async function adminCreateUser(db: Db, ctx: AuthContext, input: z.input<typeof newUserInput>) {
  assertCan(ctx, "admin.users", "manage");
  const v = newUserInput.parse(input);
  if (v.roles.includes("MEMBER")) throw new ValidationError("Member logins are created by members themselves through phone sign-in.");
  if (v.roles.includes("MINISTRY_HEAD") && !v.ministryIds?.length) throw new ValidationError("Choose the ministries this Ministry Head leads.", { ministryIds: "Choose at least one ministry" });
  if (await db.user.findUnique({ where: { email: v.email.toLowerCase() } })) throw new ValidationError("A user with this email already exists.", { email: "Already in use" });
  return createStaffUser(db, actorFrom(ctx), v);
}

/** Replace a user's roles and ministry scope (audited; sessions revoked so new permissions apply at once). */
export async function updateUserAccess(db: Db, ctx: AuthContext, userId: string, input: { roles: RoleKey[]; ministryIds: string[] }) {
  assertCan(ctx, "admin.users", "manage");
  const roles = z.array(z.enum(ROLE_KEYS)).min(1, "Choose at least one role").parse(input.roles);
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: true } }, ministryScopes: true } });
    if (!user) throw new NotFoundError("User not found.");
    const before = { roles: user.roles.map((r) => r.role.key).sort(), ministryIds: user.ministryScopes.map((s) => s.ministryId).sort() };
    const after = { roles: [...roles].sort(), ministryIds: roles.includes("MINISTRY_HEAD") ? [...new Set(input.ministryIds)].sort() : [] };
    if (after.roles.includes("MINISTRY_HEAD") && after.ministryIds.length === 0) throw new ValidationError("Choose the ministries this Ministry Head leads.");
    if (after.roles.includes("MEMBER") !== before.roles.includes("MEMBER")) throw new ValidationError("The Member role is tied to self-service sign-in and can’t be added or removed here.");
    await lastAdminGuard(tx, userId, before.roles.includes("SYSTEM_ADMIN") && !after.roles.includes("SYSTEM_ADMIN"));
    if (JSON.stringify(before) === JSON.stringify(after)) return;

    const roleRows = await tx.role.findMany({ where: { key: { in: after.roles } } });
    await tx.userRole.deleteMany({ where: { userId } });
    await tx.userRole.createMany({ data: roleRows.map((r) => ({ userId, roleId: r.id })) });
    await tx.userMinistryScope.deleteMany({ where: { userId } });
    if (after.ministryIds.length) await tx.userMinistryScope.createMany({ data: after.ministryIds.map((ministryId) => ({ userId, ministryId })) });
    await tx.session.deleteMany({ where: { userId } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "UPDATE", entity: "User", entityId: userId, field: "access", oldValue: before, newValue: after });
  });
}

/** Deactivate (signs the user out everywhere) or reactivate a login. */
export async function setUserActive(db: Db, ctx: AuthContext, userId: string, active: boolean) {
  assertCan(ctx, "admin.users", "manage");
  if (userId === ctx.userId && !active) throw new ValidationError("You can’t deactivate your own account.");
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: true } } } });
    if (!user) throw new NotFoundError("User not found.");
    if (user.active === active) return;
    await lastAdminGuard(tx, userId, !active && user.roles.some((r) => r.role.key === "SYSTEM_ADMIN"));
    await tx.user.update({ where: { id: userId }, data: { active } });
    if (!active) await tx.session.deleteMany({ where: { userId } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "SECURITY", entity: "User", entityId: userId, field: "active", oldValue: user.active, newValue: active });
  });
}

/** Remove a user's authenticator (lost phone). They must enrol again at next sign-in if their role requires 2FA. */
export async function resetUserTwoFactor(db: Db, ctx: AuthContext, userId: string) {
  assertCan(ctx, "admin.security", "manage");
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError("User not found.");
    await tx.twoFactor.deleteMany({ where: { userId } });
    await tx.user.update({ where: { id: userId }, data: { twoFactorEnabled: false } });
    await tx.session.deleteMany({ where: { userId } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "SECURITY", entity: "User", entityId: userId, note: "Two-step verification reset by an administrator" });
  });
}

/** Sign a user out of every device (or one session). */
export async function revokeSessions(db: Db, ctx: AuthContext, target: { userId?: string; sessionId?: string }) {
  assertCan(ctx, "admin.security", "manage");
  await db.$transaction(async (tx) => {
    const where = target.sessionId ? { id: target.sessionId } : { userId: target.userId };
    const sessions = await tx.session.findMany({ where, select: { id: true, userId: true } });
    if (!sessions.length) return;
    await tx.session.deleteMany({ where: { id: { in: sessions.map((s) => s.id) } } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log(
      ...sessions.map((s) => ({ action: "SECURITY" as const, entity: "Session", entityId: s.id, note: `Signed out by an administrator (user ${s.userId})` })),
    );
  });
}
