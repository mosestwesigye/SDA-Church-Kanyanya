/**
 * Permission catalog: every (resource, action) pair the app checks.
 * The Role × Permission matrix stored in the database (editable in Admin)
 * grants a subset of these, each with a scope (ALL / MINISTRY / SELF).
 */

export const ROLE_KEYS = [
  "SYSTEM_ADMIN",
  "CHURCH_CLERK",
  "ASSISTANT_CLERK",
  "PASTOR",
  "ELDER",
  "MINISTRY_HEAD",
  "TREASURER",
  "MEMBER",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  SYSTEM_ADMIN: "System Admin",
  CHURCH_CLERK: "Church Clerk",
  ASSISTANT_CLERK: "Assistant Clerk",
  PASTOR: "Pastor",
  ELDER: "Elder",
  MINISTRY_HEAD: "Ministry Head",
  TREASURER: "Treasurer",
  MEMBER: "Member",
};

export const CATALOG = {
  // Base directory record: ID, names, ministries. Treasurer stops here.
  member: ["read", "create", "update", "delete", "restore", "purge", "merge"],
  // Gender, DOB, year joined, photo, zone, profession, status, completeness.
  "member.profile": ["read", "update"],
  // Phone, email.
  "member.contact": ["read", "update"],
  // Marital status, spouse, next of kin, discipline records.
  "member.sensitive": ["read", "update"],
  ministry: ["read", "manage"],
  household: ["read", "update"],
  cleanup: ["use"],
  import: ["run"],
  status_request: ["create", "approve"],
  transfer: ["read", "update"],
  correction_request: ["create", "review"],
  document: ["read", "upload"],
  report: ["read"],
  export: ["run"],
  audit: ["read"],
  "admin.users": ["manage"],
  "admin.roles": ["manage"],
  "admin.lists": ["manage"],
  "admin.security": ["manage"],
} as const;

export type Resource = keyof typeof CATALOG;
export type Action<R extends Resource = Resource> = (typeof CATALOG)[R][number];
export type Scope = "ALL" | "MINISTRY" | "SELF";

export type Grant = { resource: Resource; action: string; scope: Scope };

export function permKey(resource: string, action: string) {
  return `${resource}:${action}`;
}

/** Field groups on Member, used for server-side field stripping. */
export const MEMBER_FIELD_GROUPS = {
  member: ["id", "memberNo", "memberId", "lastName", "firstName", "ministries", "deletedAt", "mergedIntoId", "updatedAt", "createdAt", "version"],
  "member.profile": [
    "gender", "dobDate", "dobYear", "dobPrecision", "yearJoined", "photoKey",
    "zoneId", "zone", "professionId", "profession", "status", "completeness", "missingFields",
  ],
  "member.contact": ["phoneRaw", "phoneE164", "email"],
  "member.sensitive": [
    "maritalStatus", "spouseMemberId", "spouse", "spouseName",
    "nextOfKinName", "nextOfKinPhoneRaw", "nextOfKinPhoneE164",
  ],
} as const;

export type MemberFieldGroup = keyof typeof MEMBER_FIELD_GROUPS;

export function fieldGroupOf(field: string): MemberFieldGroup | null {
  for (const [group, fields] of Object.entries(MEMBER_FIELD_GROUPS)) {
    if ((fields as readonly string[]).includes(field)) return group as MemberFieldGroup;
  }
  return null;
}

/** Roles for which TOTP 2FA is mandatory. */
/** Only System Administrators use an authenticator app; everyone else signs in with a password (members by SMS code). */
export const REQUIRE_2FA: RoleKey[] = ["SYSTEM_ADMIN"];
