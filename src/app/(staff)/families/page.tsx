import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NewHousehold } from "@/components/groups/group-widgets";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { requirePermission } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { db } from "@/server/db";
import { RELATION_LABELS, listHouseholds, spouseHouseholdSuggestions } from "@/server/households/service";

export const metadata: Metadata = { title: "Families / Cells" };

export default async function FamiliesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requirePermission("household", "read");
  if (!can(ctx, "member.sensitive", "read")) redirect("/denied?need=member.sensitive:read");
  const { q } = await searchParams;
  const [{ total, rows }, suggestions] = await Promise.all([listHouseholds(db, ctx, q ?? ""), spouseHouseholdSuggestions(db, ctx, 6)]);
  const canEdit = can(ctx, "household", "update");
  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7">
        <PageHeader title="Families / Cells" subtitle="Group members into families or cells, with a head or cell leader. Spouse links also show on each member’s Family tab." />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section>
            <form className="mb-3 flex gap-2" action="/families" role="search">
              <label htmlFor="hh-search" className="sr-only">Search families and cells</label>
              <input id="hh-search" name="q" defaultValue={q} className="input max-w-sm" placeholder="Family, cell or member name" type="search" />
              <button className="btn btn-secondary">Search</button>
            </form>
            {rows.length === 0 ? (
              <div className="card p-10 text-center">
                <h2 className="text-[17px] font-semibold">{q ? "No families or cells match" : "No families or cells yet"}</h2>
                <p className="mt-2 text-ink-2">Create one from the panel, or start from a married couple below.</p>
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {rows.map((h) => (
                  <li key={h.id}>
                    <Link href={`/families/${h.id}`} className="card block p-4 hover:border-primary">
                      <span className="block text-[17px] font-semibold">{h.name}</span>
                      <span className="block text-[13px] text-ink-2">{h.members.length} member{h.members.length === 1 ? "" : "s"}</span>
                      <ul className="mt-2 space-y-0.5 text-[14px]">
                        {h.members.slice(0, 5).map((m) => (
                          <li key={m.memberId}>{m.member.firstName} {m.member.lastName} <span className="text-ink-3">· {RELATION_LABELS[m.relation]}</span></li>
                        ))}
                      </ul>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {total > rows.length && <p className="mt-3 text-[14px] text-ink-2">Showing {rows.length} of {total}. Search to narrow down.</p>}
          </section>
          <aside className="space-y-5">
            {canEdit && (
              <section className="card p-5">
                <h2 className="mb-3 text-[17px] font-semibold">New family or cell</h2>
                <NewHousehold />
              </section>
            )}
            {canEdit && suggestions.length > 0 && (
              <section className="card p-5">
                <h2 className="text-[17px] font-semibold">Married couples not yet in a family</h2>
                <ul className="mt-3 space-y-3">
                  {suggestions.map((s) => (
                    <li key={s.id} className="rounded-[8px] border border-line p-3 text-[14px]">
                      <p className="mb-2">
                        {s.firstName} {s.lastName} & {s.spouse!.firstName} {s.spouse!.lastName}
                      </p>
                      <NewHousehold suggestion={{ name: `${s.lastName} family`, head: { id: s.id, memberId: s.memberId, lastName: s.lastName, firstName: s.firstName } }} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}
