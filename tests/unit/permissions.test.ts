import { describe, expect, it } from "vitest";
import { ROLE_KEYS, type RoleKey } from "@/server/authz/catalog";
import { DEFAULT_MATRIX } from "@/server/authz/defaults";
import {
  assertCanUpdateFields,
  buildGrantMap,
  can,
  memberScopeWhere,
  memberSelect,
  projectMember,
  type AuthContext,
} from "@/server/authz/policy";
import { ForbiddenError } from "@/server/errors";

function ctxFor(roles: RoleKey[], extra: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "u1",
    label: "Test",
    roles,
    grants: buildGrantMap(roles.flatMap((r) => DEFAULT_MATRIX[r])),
    ministryIds: [],
    memberId: null,
    ...extra,
  };
}

const ROW = {
  id: "m1",
  memberId: "SDAK/M0001",
  lastName: "Namubiru",
  firstName: "Esther",
  ministries: [{ ministryId: "youth" }],
  gender: "FEMALE",
  zoneId: "z1",
  phoneE164: "+256752664091",
  email: null,
  maritalStatus: "MARRIED",
  spouseName: "Charles",
  nextOfKinName: "Mary",
  nextOfKinPhoneE164: "+256772000000",
};

const SENSITIVE_READERS: RoleKey[] = ["SYSTEM_ADMIN", "CHURCH_CLERK", "ASSISTANT_CLERK", "PASTOR", "ELDER"];

describe("default permission matrix", () => {
  it.each(ROLE_KEYS)("%s: sensitive fields only for Clerk, Asst Clerk, Pastor, Elders and Admin", (role) => {
    const ctx = ctxFor([role]);
    const expected = SENSITIVE_READERS.includes(role) || role === "MEMBER"; // members: their own record only
    expect(can(ctx, "member.sensitive", "read")).toBe(expected);
  });

  it("member role reads sensitive data only on their own record", () => {
    const ctx = ctxFor(["MEMBER"], { memberId: "m1" });
    expect(projectMember(ctx, ROW).restricted).toEqual([]);
    expect(projectMember(ctx, { ...ROW, id: "m2" }).restricted).toEqual(["member.profile", "member.contact", "member.sensitive"]);
  });

  it("only Pastor and Admin approve status changes by default", () => {
    const approvers = ROLE_KEYS.filter((r) => can(ctxFor([r]), "status_request", "approve"));
    expect(approvers.sort()).toEqual(["PASTOR", "SYSTEM_ADMIN"]);
  });

  it("only Admin can purge or manage the permission matrix", () => {
    for (const r of ROLE_KEYS) {
      const ctx = ctxFor([r]);
      expect(can(ctx, "member", "purge")).toBe(r === "SYSTEM_ADMIN");
      expect(can(ctx, "admin.roles", "manage")).toBe(r === "SYSTEM_ADMIN");
    }
  });
});

describe("field-level restriction (server-side stripping)", () => {
  it("never selects sensitive columns for roles without access", () => {
    for (const role of ["MINISTRY_HEAD", "TREASURER"] as RoleKey[]) {
      const select = memberSelect(ctxFor([role]));
      for (const f of ["maritalStatus", "spouseName", "spouseMemberId", "nextOfKinName", "nextOfKinPhoneE164"]) {
        expect(select).not.toHaveProperty(f);
      }
    }
  });

  it("treasurer gets a limited directory: name, ID and ministry", () => {
    const ctx = ctxFor(["TREASURER"]);
    const select = memberSelect(ctx);
    expect(select).toHaveProperty("lastName");
    expect(select).toHaveProperty("memberId");
    expect(select).toHaveProperty("ministries");
    expect(select).not.toHaveProperty("phoneE164");
    expect(select).not.toHaveProperty("gender");
    const p = projectMember(ctx, ROW);
    expect(p).not.toHaveProperty("phoneE164");
    expect(p).not.toHaveProperty("gender");
    expect(p.restricted).toEqual(["member.profile", "member.contact", "member.sensitive"]);
  });

  it("clerk sees everything", () => {
    const p = projectMember(ctxFor(["CHURCH_CLERK"]), ROW);
    expect(p.restricted).toEqual([]);
    expect(p.nextOfKinName).toBe("Mary");
  });

  it("strips per row for mixed roles (Treasurer + Ministry Head)", () => {
    const ctx = ctxFor(["TREASURER", "MINISTRY_HEAD"], { ministryIds: ["youth"] });
    expect(projectMember(ctx, ROW).restricted).toEqual(["member.sensitive"]);
    const other = projectMember(ctx, { ...ROW, ministries: [{ ministryId: "choir" }] });
    expect(other.restricted).toEqual(["member.profile", "member.contact", "member.sensitive"]);
    expect(other).not.toHaveProperty("phoneE164");
  });
});

describe("scoping", () => {
  it("ministry heads only query members of their ministries", () => {
    const where = memberScopeWhere(ctxFor(["MINISTRY_HEAD"], { ministryIds: ["youth", "music"] }));
    expect(where).toEqual({ ministries: { some: { ministryId: { in: ["youth", "music"] } } } });
  });

  it("a ministry head with no ministries sees nobody", () => {
    expect(memberScopeWhere(ctxFor(["MINISTRY_HEAD"]))).toEqual({ ministries: { some: { ministryId: { in: ["__none__"] } } } });
  });

  it("members only query themselves", () => {
    expect(memberScopeWhere(ctxFor(["MEMBER"], { memberId: "m9" }))).toEqual({ id: "m9" });
    expect(memberScopeWhere(ctxFor(["MEMBER"]))).toEqual({ id: "__none__" });
  });

  it("roles without member:read are refused", () => {
    expect(() => memberScopeWhere(ctxFor([]))).toThrow(ForbiddenError);
  });
});

describe("write checks", () => {
  it("assistant clerk may edit contact and sensitive fields", () => {
    expect(() => assertCanUpdateFields(ctxFor(["ASSISTANT_CLERK"]), ["phoneE164", "nextOfKinName"], ROW)).not.toThrow();
  });
  it("pastor and elders are read-only on member fields", () => {
    for (const r of ["PASTOR", "ELDER"] as RoleKey[]) {
      expect(() => assertCanUpdateFields(ctxFor([r]), ["phoneE164"], ROW)).toThrow(ForbiddenError);
    }
  });
  it("members cannot edit their own record directly (they file a correction request)", () => {
    expect(() => assertCanUpdateFields(ctxFor(["MEMBER"], { memberId: "m1" }), ["phoneE164"], ROW)).toThrow(ForbiddenError);
  });
  it("unknown fields are refused", () => {
    expect(() => assertCanUpdateFields(ctxFor(["SYSTEM_ADMIN"]), ["memberNo2"], ROW)).toThrow(/cannot be edited/);
  });
});
