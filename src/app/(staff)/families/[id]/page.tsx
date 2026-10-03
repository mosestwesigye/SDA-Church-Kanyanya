import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AddHouseholdMember, RelationSelect, RemoveFromHousehold } from "@/components/groups/group-widgets";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { StatusBadge } from "@/components/ui/badges";
import { formatDob } from "@/lib/dob";
import { MARITAL_LABELS } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { RELATION_LABELS, getHousehold } from "@/server/households/service";

export const metadata: Metadata = { title: "Family / cell" };

export default async function HouseholdPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("household", "read");
  const { id } = await params;
  let h;
  try {
    h = await getHousehold(db, ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) redirect("/denied?need=member.sensitive:read");
    throw e;
  }
  const canEdit = can(ctx, "household", "update");
  const head = h.members.find((m) => m.relation === "HEAD");
  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7">
        <nav aria-label="Breadcrumb" className="mb-3 text-[14px] text-ink-2"><Link href="/families" className="hover:underline">Families / Cells</Link> / {h.name}</nav>
        <PageHeader title={h.name} subtitle={`${h.members.length} member${h.members.length === 1 ? "" : "s"}`} />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="card overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wider text-ink-2">
                <tr>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Relation</th>
                  <th className="px-4 py-3">Born</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Next of kin</th>
                  {canEdit && <th className="px-4 py-3"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {h.members.map((row) => {
                  const m = row.member;
                  const name = `${m.lastName}, ${m.firstName}`;
                  const spouseLinked = head && row.relation === "SPOUSE" && m.spouseMemberId === head.memberId;
                  return (
                    <tr key={m.id} className="border-t border-line align-top">
                      <td className="px-4 py-2.5">
                        <Link href={`/members/${m.id}?tab=family`} className="font-semibold hover:underline">{name}</Link>
                        <span className="mono block text-[12px] text-ink-3">{m.memberId}</span>
                        {m.maritalStatus && <span className="block text-[12px] text-ink-2">{MARITAL_LABELS[m.maritalStatus]}{spouseLinked ? " · spouse linked" : ""}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {canEdit ? <RelationSelect householdId={h.id} memberId={m.id} relation={row.relation} label={name} hasOtherHead={Boolean(head && head.memberId !== m.id)} /> : RELATION_LABELS[row.relation]}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{formatDob(m.dobPrecision, m.dobDate, m.dobYear) ?? "—"}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={m.status} /></td>
                      <td className="px-4 py-2.5">{m.nextOfKinName ? `${m.nextOfKinName}${m.nextOfKinPhoneRaw ? ` · ${m.nextOfKinPhoneRaw}` : ""}` : "—"}</td>
                      {canEdit && <td className="px-4 py-2.5 text-right"><RemoveFromHousehold householdId={h.id} memberId={m.id} label={name} /></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          {canEdit && (
            <aside className="card h-fit p-5">
              <h2 className="mb-3 text-[17px] font-semibold">Add a member</h2>
              <AddHouseholdMember householdId={h.id} hasHead={Boolean(head)} />
            </aside>
          )}
        </div>
      </main>
    </>
  );
}
