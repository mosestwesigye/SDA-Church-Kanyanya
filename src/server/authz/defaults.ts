import { CATALOG, type Grant, type Resource, type RoleKey, type Scope } from "./catalog";

/** Every catalog permission with ALL scope. */
function everything(): Grant[] {
  return (Object.entries(CATALOG) as [Resource, readonly string[]][]).flatMap(([resource, actions]) =>
    actions.map((action) => ({ resource, action, scope: "ALL" as Scope })),
  );
}

function g(spec: Record<string, string[]>, scope: Scope = "ALL"): Grant[] {
  return Object.entries(spec).flatMap(([resource, actions]) =>
    actions.map((action) => ({ resource: resource as Resource, action, scope })),
  );
}

const READ_ALL_MEMBER_DATA = {
  member: ["read"],
  "member.profile": ["read"],
  "member.contact": ["read"],
  "member.sensitive": ["read"],
};

/**
 * Default permission matrix, seeded into the database. Admins can change it
 * afterwards; these are only the starting values.
 */
export const DEFAULT_MATRIX: Record<RoleKey, Grant[]> = {
  SYSTEM_ADMIN: everything(),

  CHURCH_CLERK: g({
    member: ["read", "create", "update", "delete", "restore", "merge"],
    "member.profile": ["read", "update"],
    "member.contact": ["read", "update"],
    "member.sensitive": ["read", "update"],
    ministry: ["read", "manage"],
    household: ["read", "update"],
    cleanup: ["use"],
    import: ["run"],
    status_request: ["create"],
    transfer: ["read", "update"],
    correction_request: ["review"],
    document: ["read", "upload"],
    report: ["read"],
    export: ["run"],
    audit: ["read"],
    minutes: ["read", "manage"],
  }),

  ASSISTANT_CLERK: g({
    member: ["read", "create", "update"],
    "member.profile": ["read", "update"],
    "member.contact": ["read", "update"],
    "member.sensitive": ["read", "update"],
    ministry: ["read"],
    household: ["read", "update"],
    cleanup: ["use"],
    status_request: ["create"],
    transfer: ["read", "update"],
    correction_request: ["review"],
    document: ["read", "upload"],
    report: ["read"],
    export: ["run"],
    audit: ["read"],
    minutes: ["read", "manage"],
  }),

  PASTOR: g({
    ...READ_ALL_MEMBER_DATA,
    ministry: ["read"],
    household: ["read"],
    status_request: ["create", "approve"],
    transfer: ["read", "update"],
    document: ["read"],
    report: ["read"],
    export: ["run"],
    audit: ["read"],
    minutes: ["read"],
  }),

  ELDER: g({
    ...READ_ALL_MEMBER_DATA,
    ministry: ["read"],
    household: ["read"],
    status_request: ["create"],
    transfer: ["read"],
    document: ["read"],
    report: ["read"],
    minutes: ["read"],
  }),

  MINISTRY_HEAD: g(
    {
      member: ["read"],
      "member.profile": ["read"],
      "member.contact": ["read"],
      ministry: ["read", "manage"],
      report: ["read"],
    },
    "MINISTRY",
  ),

  // Limited directory: name, ID, ministry only.
  TREASURER: g({ member: ["read"], ministry: ["read"] }),

  MEMBER: g(
    {
      member: ["read"],
      "member.profile": ["read"],
      "member.contact": ["read"],
      "member.sensitive": ["read"],
      correction_request: ["create"],
    },
    "SELF",
  ),
};
