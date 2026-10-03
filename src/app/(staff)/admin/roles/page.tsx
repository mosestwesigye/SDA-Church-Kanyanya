import type { Metadata } from "next";
import { ScopeCell } from "@/components/admin/matrix-widgets";
import { ROLE_LABELS } from "@/server/authz/catalog";
import { permissionMatrix } from "@/server/admin/roles";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Roles & permissions · Admin" };

const ACTION_LABELS: Record<string, string> = {
  read: "View", create: "Add", update: "Edit", delete: "Delete", restore: "Restore", purge: "Purge", merge: "Merge",
  manage: "Manage", use: "Use", run: "Run", approve: "Approve", upload: "Upload", review: "Review",
};

export default async function RolesPage() {
  const ctx = await requirePermission("admin.roles", "manage");
  const m = await permissionMatrix(db, ctx);
  return (
    <>
      <p className="mb-4 max-w-3xl text-ink-2">
        What each role may do. <strong>All</strong> covers every member; <strong>Own ministries</strong> only members of the ministries a user leads; <strong>Own record</strong> only the
        member linked to the login. Field groups (profile, contact, sensitive) are enforced on the server. Changes apply on the user’s next page load and are audited.
      </p>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[1250px] text-[14px]">
          <caption className="sr-only">Permission matrix</caption>
          <thead className="sticky top-0 bg-surface-2 text-left text-[11px] uppercase tracking-wider text-ink-2">
            <tr>
              <th scope="col" className="px-3 py-3">Permission</th>
              {m.roles.map((r) => (
                <th key={r.id} scope="col" className="px-2 py-3">
                  {ROLE_LABELS[r.key] ?? r.name}
                  <span className="block font-normal normal-case tracking-normal">{r.users} user{r.users === 1 ? "" : "s"}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.catalog.map((res) =>
              res.actions.map((a, i) => (
                <tr key={`${res.resource}:${a}`} className={`${i === 0 ? "border-t-2" : "border-t"} border-line`}>
                  <th scope="row" className="min-w-[250px] px-3 py-1.5 text-left font-normal">
                    {i === 0 && <span className="block font-semibold">{res.label}</span>}
                    <span className="text-ink-2">{ACTION_LABELS[a] ?? a}</span>
                  </th>
                  {m.roles.map((r) => (
                    <td key={r.id} className="px-2 py-1.5">
                      <ScopeCell
                        roleId={r.id}
                        resource={res.resource}
                        action={a}
                        scope={r.grants[`${res.resource}:${a}`] ?? null}
                        label={`${ROLE_LABELS[r.key] ?? r.name}: ${res.label} — ${ACTION_LABELS[a] ?? a}`}
                        locked={m.locked.includes(`${r.key}|${res.resource}:${a}`)}
                      />
                    </td>
                  ))}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
