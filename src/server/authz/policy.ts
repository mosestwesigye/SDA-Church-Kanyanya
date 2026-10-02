import { ForbiddenError } from "../errors";
import {
  MEMBER_FIELD_GROUPS,
  fieldGroupOf,
  permKey,
  type MemberFieldGroup,
  type Resource,
  type RoleKey,
  type Scope,
} from "./catalog";

/**
 * Everything the authorization layer needs to know about the caller.
 * Built once per request by `loadAuthContext` (see context.ts); the
 * functions in this file are pure so they can be unit-tested directly.
 */
export type AuthContext = {
  userId: string;
  label: string;
  roles: RoleKey[];
  /** "resource:action" → broadest scope granted by any of the user's roles. */
  grants: Map<string, Scope>;
  /** Ministries a Ministry Head is scoped to. */
  ministryIds: string[];
  /** Member record linked to this login (self-service). */
  memberId: string | null;
  sessionId?: string | null;
  ipAddress?: string | null;
};

const RANK: Record<Scope, number> = { SELF: 1, MINISTRY: 2, ALL: 3 };

export function broadest(a: Scope | undefined, b: Scope): Scope {
  return !a || RANK[b] > RANK[a] ? b : a;
}

export function buildGrantMap(rows: { resource: string; action: string; scope: Scope }[]): Map<string, Scope> {
  const map = new Map<string, Scope>();
  for (const r of rows) {
    const k = permKey(r.resource, r.action);
    map.set(k, broadest(map.get(k), r.scope));
  }
  return map;
}

export function scopeOf(ctx: AuthContext, resource: Resource, action: string): Scope | null {
  return ctx.grants.get(permKey(resource, action)) ?? null;
}

export function can(ctx: AuthContext, resource: Resource, action: string): boolean {
  return scopeOf(ctx, resource, action) !== null;
}

export function assertCan(ctx: AuthContext, resource: Resource, action: string): Scope {
  const scope = scopeOf(ctx, resource, action);
  if (!scope) throw new ForbiddenError();
  return scope;
}

/** Minimal shape of a member row needed for row-level checks. */
export type MemberScopeRow = { id: string; ministries?: { ministryId: string }[] };

/** Does `scope` cover this particular member row for this caller? */
export function scopeCovers(ctx: AuthContext, scope: Scope | null, row: MemberScopeRow): boolean {
  if (!scope) return false;
  if (scope === "ALL") return true;
  if (scope === "SELF") return ctx.memberId !== null && row.id === ctx.memberId;
  const ids = new Set(ctx.ministryIds);
  return (row.ministries ?? []).some((m) => ids.has(m.ministryId));
}

export function canOnMember(ctx: AuthContext, resource: Resource, action: string, row: MemberScopeRow): boolean {
  return scopeCovers(ctx, scopeOf(ctx, resource, action), row);
}

/**
 * Prisma `where` fragment restricting members to what the caller may see
 * for `member:<action>`. Throws when the caller has no grant at all.
 */
export function memberScopeWhere(ctx: AuthContext, action = "read"): Record<string, unknown> {
  const scope = assertCan(ctx, "member", action);
  switch (scope) {
    case "ALL":
      return {};
    case "SELF":
      return { id: ctx.memberId ?? "__none__" };
    case "MINISTRY":
      return { ministries: { some: { ministryId: { in: ctx.ministryIds.length ? ctx.ministryIds : ["__none__"] } } } };
  }
}

const GROUPS = Object.keys(MEMBER_FIELD_GROUPS) as MemberFieldGroup[];

/** Field groups the caller can read on *some* rows — used to build the SELECT. */
export function selectableGroups(ctx: AuthContext): MemberFieldGroup[] {
  return GROUPS.filter((g) => can(ctx, g, "read"));
}

/**
 * Build a Prisma `select` for Member that only loads the columns the caller
 * may read. Restricted columns are never fetched from the database.
 */
export function memberSelect(ctx: AuthContext): Record<string, unknown> {
  const select: Record<string, unknown> = {};
  for (const group of selectableGroups(ctx)) {
    for (const f of MEMBER_FIELD_GROUPS[group]) {
      if (f === "ministries") {
        select.ministries = {
          select: {
            ministryId: true,
            roleId: true,
            ministry: { select: { id: true, label: true } },
            role: { select: { id: true, label: true } },
          },
        };
      } else if (f === "zone" || f === "profession") {
        select[f] = { select: { id: true, label: true } };
      } else if (f === "spouse") {
        select.spouse = { select: { id: true, memberId: true, lastName: true, firstName: true } };
      } else {
        select[f] = true;
      }
    }
  }
  // Always needed for row-level scope checks.
  select.id = true;
  select.ministries ??= { select: { ministryId: true } };
  return select;
}

export type Projected<T> = T & { restricted: MemberFieldGroup[] };

/**
 * Strip field groups this caller may not read *for this row* (a Ministry
 * Head who is also Treasurer sees profile fields only for their ministries'
 * members) and list them under `restricted` so the UI can show placeholders.
 */
export function projectMember<T extends MemberScopeRow & Record<string, unknown>>(ctx: AuthContext, row: T): Projected<T> {
  const out: Record<string, unknown> = { ...row };
  const restricted: MemberFieldGroup[] = [];
  for (const group of GROUPS) {
    if (group === "member") continue;
    if (!canOnMember(ctx, group, "read", row)) {
      restricted.push(group);
      for (const f of MEMBER_FIELD_GROUPS[group]) delete out[f];
    }
  }
  return { ...(out as T), restricted };
}

/** Throws unless the caller may update every field in `fields` on this row. */
export function assertCanUpdateFields(ctx: AuthContext, fields: string[], row: MemberScopeRow): void {
  if (!canOnMember(ctx, "member", "update", row)) throw new ForbiddenError();
  for (const f of fields) {
    const group = fieldGroupOf(f);
    if (!group) throw new ForbiddenError(`Field "${f}" cannot be edited.`);
    const resource = group === "member" ? "member" : group;
    if (!canOnMember(ctx, resource, "update", row)) {
      throw new ForbiddenError(`You cannot edit ${f}.`);
    }
  }
}

export function hasRole(ctx: AuthContext, ...roles: RoleKey[]): boolean {
  return ctx.roles.some((r) => roles.includes(r));
}
