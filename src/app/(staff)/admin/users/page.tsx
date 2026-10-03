import type { Metadata } from "next";
import { EditAccess, NewUser, UserActions } from "@/components/admin/user-widgets";
import { EmptyState } from "@/components/ui/states";
import { ROLE_KEYS, ROLE_LABELS } from "@/server/authz/catalog";
import { can } from "@/server/authz/policy";
import { listUsers } from "@/server/admin/users";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Users · Admin" };

export default async function UsersPage() {
  const ctx = await requirePermission("admin.users", "manage");
  const [users, ministries] = await Promise.all([
    listUsers(db, ctx),
    db.listItem.findMany({ where: { type: "MINISTRY", active: true, mergedIntoId: null }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }], select: { id: true, label: true } }),
  ]);
  const roles = ROLE_KEYS.filter((k) => k !== "MEMBER").map((key) => ({ key, label: ROLE_LABELS[key] }));
  const staff = users.filter((u) => !u.roles.includes("MEMBER"));
  const members = users.length - staff.length;
  const canSecurity = can(ctx, "admin.security", "manage");
  const fmt = (d: Date | null) => (d ? d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kampala" }) : "Never");

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <p className="text-ink-2">
          {staff.length} staff login{staff.length === 1 ? "" : "s"}
          {members > 0 && ` · ${members} member self-service login${members === 1 ? "" : "s"}`}. Every change is recorded in the audit log.
        </p>
        <NewUser roles={roles} ministries={ministries} />
      </div>
      {users.length === 0 ? (
        <EmptyState title="No users yet" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wider text-ink-2">
              <tr>
                <th scope="col" className="px-4 py-3">User</th>
                <th scope="col" className="px-4 py-3">Roles</th>
                <th scope="col" className="px-4 py-3">2FA</th>
                <th scope="col" className="px-4 py-3">Last sign-in</th>
                <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isMember = u.roles.includes("MEMBER");
                return (
                  <tr key={u.id} className={`border-t border-line align-top ${u.active ? "" : "text-ink-3"}`}>
                    <td className="px-4 py-3">
                      <span className="block font-semibold">{u.name}{!u.active && <span className="ml-2 rounded bg-surface-2 px-2 py-0.5 text-[12px] font-normal">Deactivated</span>}</span>
                      <span className="block text-[13px] text-ink-2">{isMember ? (u.member?.memberId ?? "Member") : u.email}</span>
                    </td>
                    <td className="px-4 py-3">
                      {u.roles.map((r) => ROLE_LABELS[r]).join(", ")}
                      {u.ministries.length > 0 && <span className="block text-[13px] text-ink-2">{u.ministries.map((m) => m.label).join(", ")}</span>}
                    </td>
                    <td className="px-4 py-3">{u.twoFactorEnabled ? "On" : isMember ? "SMS code" : "Off"}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-[14px]">{fmt(u.lastLoginAt)}{u.activeSessions > 0 && <span className="block text-[13px] text-ink-2">{u.activeSessions} active session{u.activeSessions === 1 ? "" : "s"}</span>}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {!isMember && <EditAccess userId={u.id} name={u.name} roles={roles} ministries={ministries} current={u.roles} currentMinistries={u.ministries.map((m) => m.id)} />}
                      <UserActions userId={u.id} name={u.name} active={u.active} twoFactor={u.twoFactorEnabled} sessions={u.activeSessions} self={u.id === ctx.userId} canSecurity={canSecurity} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
