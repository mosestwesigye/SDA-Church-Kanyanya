import type { MembershipStatus, Prisma } from "@/generated/prisma/client";

/**
 * The active register (Church Clerk's rule): only Active and Irregular members
 * count in the dashboard and reports. Everyone else — no status yet, dormant, missing, self
 * transferred, under discipline, left the faith, deceased — is dormant until
 * the clerk updates their status.
 */
export const ACTIVE_STATUSES = ["ACTIVE", "IRREGULAR"] as const satisfies readonly MembershipStatus[];
export const DORMANT_STATUSES = ["DORMANT", "MISSING", "SELF_TRANSFERRED", "UNDER_DISCIPLINE", "LEFT_THE_FAITH", "DECEASED"] as const satisfies readonly MembershipStatus[];

export const isActiveStatus = (s: MembershipStatus | string | null | undefined) => s === "ACTIVE" || s === "IRREGULAR";

export const activeWhere: Prisma.MemberWhereInput = { status: { in: [...ACTIVE_STATUSES] } };
export const dormantWhere: Prisma.MemberWhereInput = { OR: [{ status: null }, { status: { in: [...DORMANT_STATUSES] } }] };
