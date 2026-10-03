import { can, scopeOf, type AuthContext } from "@/server/authz/policy";

export function adminTabs(ctx: AuthContext) {
  return [
    { href: "/admin/users", label: "Users", ok: can(ctx, "admin.users", "manage") },
    { href: "/admin/roles", label: "Roles & permissions", ok: can(ctx, "admin.roles", "manage") },
    { href: "/admin/lists", label: "Lists", ok: can(ctx, "admin.lists", "manage") },
    { href: "/admin/rules", label: "Data rules", ok: can(ctx, "admin.lists", "manage") },
    { href: "/admin/security", label: "Security", ok: can(ctx, "admin.security", "manage") },
    { href: "/admin/audit", label: "Audit log", ok: scopeOf(ctx, "audit", "read") === "ALL" },
  ]
    .filter((t) => t.ok)
    .map(({ href, label }) => ({ href, label }));
}
