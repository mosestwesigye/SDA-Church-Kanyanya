import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AddToMinistry, RemoveFromMinistry, RoleSelect } from "@/components/groups/group-widgets";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { StatusBadge } from "@/components/ui/badges";
import type { StatusKey } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { ministryRoster } from "@/server/ministries/service";

export const metadata: Metadata = { title: "Ministry" };

export default async function MinistryPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("ministry", "read");
  const { id } = await params;
  let data;
  try {
    data = await ministryRoster(db, ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) redirect("/denied?need=ministry:read");
    throw e;
  }
  const roles = (await db.listItem.findMany({ where: { type: "MINISTRY_ROLE", active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, label: true } }));
  const { ministry, roster, canManage } = data;
  const showContact = roster.some((r) => !r.member.restricted.includes("member.contact"));
  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7">
        <nav aria-label="Breadcrumb" className="mb-3 text-[14px] text-ink-2"><Link href="/ministries" className="hover:underline">Ministries</Link> / {ministry.label}</nav>
        <PageHeader title={ministry.label} subtitle={`${roster.length} member${roster.length === 1 ? "" : "s"}`}>
          {can(ctx, "report", "read") && <Link className="btn btn-secondary" href={`/reports/ministry-roster?ministry=${ministry.id}`}>Roster report</Link>}
        </PageHeader>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="card overflow-x-auto">
            {roster.length === 0 ? (
              <p className="p-8 text-center text-ink-2">Nobody is linked to this ministry yet.</p>
            ) : (
              <table className="w-full text-[15px]">
                <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wider text-ink-2">
                  <tr>
                    <th className="px-4 py-3">Member</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Status</th>
                    {showContact && <th className="px-4 py-3">Phone</th>}
                    {canManage && <th className="px-4 py-3"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {roster.map((r) => {
                    const m = r.member as unknown as { id: string; memberId: string; lastName: string; firstName: string; status?: StatusKey | null; phoneRaw?: string | null; restricted: string[] };
                    const name = `${m.lastName}, ${m.firstName}`;
                    return (
                      <tr key={r.linkId} className="border-t border-line">
                        <td className="px-4 py-2.5">
                          <Link href={`/members/${m.id}`} className="font-semibold hover:underline">{name}</Link>
                          <span className="mono block text-[12px] text-ink-3">{m.memberId}</span>
                        </td>
                        <td className="px-4 py-2.5">{canManage ? <RoleSelect ministryId={ministry.id} linkId={r.linkId} roleId={r.roleId} roles={roles} label={name} /> : r.role}</td>
                        <td className="px-4 py-2.5">{m.restricted.includes("member.profile") ? <span className="text-ink-3 text-[13px]">Restricted</span> : <StatusBadge status={m.status ?? null} />}</td>
                        {showContact && <td className="px-4 py-2.5 whitespace-nowrap">{m.restricted.includes("member.contact") ? <span className="text-ink-3 text-[13px]">Restricted</span> : (m.phoneRaw ?? "—")}</td>}
                        {canManage && <td className="px-4 py-2.5 text-right"><RemoveFromMinistry ministryId={ministry.id} linkId={r.linkId} label={name} /></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
          {canManage && (
            <aside className="card h-fit p-5">
              <h2 className="mb-3 text-[17px] font-semibold">Add to {ministry.label}</h2>
              <AddToMinistry ministryId={ministry.id} roles={roles} />
            </aside>
          )}
        </div>
      </main>
    </>
  );
}
