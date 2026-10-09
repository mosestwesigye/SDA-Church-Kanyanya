import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { HouseholdKind } from "@/generated/prisma/client";
import { AddHouseholdMember, NewGroup, RelationSelect, RemoveFromHousehold, RenameHousehold } from "@/components/groups/group-widgets";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { StatusBadge } from "@/components/ui/badges";
import { formatDob } from "@/lib/dob";
import { requirePermission } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getHousehold, KINDS, listHouseholds, relationLabel } from "@/server/households/service";

const INTRO: Record<HouseholdKind, string> = {
  FAMILY: "Church families (groups) with their leader and members. A member can be in one family and one cell.",
  CELL: "Cell groups with their leader and members. A member can be in one family and one cell.",
};

/** Families or Cells list page. */
export async function HouseholdList({ kind, q }: { kind: HouseholdKind; q?: string }) {
  const ctx = await requirePermission("household", "read");
  if (!can(ctx, "member.sensitive", "read")) redirect("/denied?need=member.sensitive:read");
  const k = KINDS[kind];
  const canEdit = can(ctx, "household", "update");
  const { total, rows } = await listHouseholds(db, ctx, kind, q ?? "");
  const people = rows.reduce((n, h) => n + h.members.length, 0);

  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7">
        <PageHeader title={k.plural} subtitle={INTRO[kind]} />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section>
            <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-3">
              <form className="flex flex-1 gap-2" action={k.path} role="search">
                <label htmlFor="hh-search" className="sr-only">Search {k.plural.toLowerCase()}</label>
                <input id="hh-search" name="q" defaultValue={q} className="input max-w-md" placeholder={`${k.title} name or member name`} type="search" />
                <button className="btn btn-secondary">Search</button>
                {q && <Link href={k.path} className="btn btn-secondary">Clear</Link>}
              </form>
              <p className="px-2 text-[13px] text-ink-2">
                <strong className="text-ink">{total.toLocaleString("en-UG")}</strong> {total === 1 ? k.one : k.plural.toLowerCase()}
                {!q && <> · {people.toLocaleString("en-UG")} members</>}
              </p>
            </div>

            {rows.length === 0 ? (
              <div className="card p-10 text-center">
                <h2 className="text-[17px] font-semibold">{q ? `No ${k.plural.toLowerCase()} match “${q}”` : `No ${k.plural.toLowerCase()} yet`}</h2>
                <p className="mt-2 text-ink-2">{canEdit ? `Create the first ${k.one} with the form on the right.` : `${k.plural} added by the clerk will appear here.`}</p>
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {rows.map((h) => {
                  const head = h.members.find((m) => m.relation === "HEAD")?.member;
                  const others = h.members.length - (head ? 1 : 0);
                  return (
                    <li key={h.id}>
                      <Link href={`${k.path}/${h.id}`} className="card flex h-full flex-col p-4 transition-colors hover:border-primary">
                        <span className="flex items-start justify-between gap-3">
                          <span className="text-[16px] font-semibold leading-snug">{h.name}</span>
                          <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[12px] font-semibold text-primary">{h.members.length}</span>
                        </span>
                        <span className="mt-2 space-y-0.5 text-[13px] text-ink-2">
                          <span className="block">Leader: <span className="text-ink">{head ? `${head.firstName} ${head.lastName}` : "Not set"}</span></span>
                          <span className="block">{others} member{others === 1 ? "" : "s"}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {total > rows.length && <p className="mt-3 text-[14px] text-ink-2">Showing {rows.length} of {total}. Search to narrow down.</p>}
          </section>

          <aside className="space-y-5">
            {canEdit && (
              <section className="card p-5">
                <h2 className="mb-1 text-[17px] font-semibold">New {k.one}</h2>
                <p className="mb-4 text-[13px] text-ink-2">Name the {k.one} and, if known, its leader. Members can be added next.</p>
                <NewGroup kind={kind} />
              </section>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}

/** One family or cell. */
export async function HouseholdDetail({ kind, id }: { kind: HouseholdKind; id: string }) {
  const ctx = await requirePermission("household", "read");
  let h;
  try {
    h = await getHousehold(db, ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) redirect("/denied?need=member.sensitive:read");
    throw e;
  }
  if (h.kind !== kind) redirect(`${KINDS[h.kind].path}/${h.id}`);
  const k = KINDS[kind];
  const canEdit = can(ctx, "household", "update");
  const head = h.members.find((m) => m.relation === "HEAD");
  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7">
        <nav aria-label="Breadcrumb" className="mb-3 text-[14px] text-ink-2">
          <Link href={k.path} className="hover:underline">{k.plural}</Link> <span className="text-ink-3">/</span> {h.name}
        </nav>
        <PageHeader title={h.name} subtitle={`${k.title} · ${h.members.length} member${h.members.length === 1 ? "" : "s"}`}>
          {canEdit && <RenameHousehold id={h.id} name={h.name} kind={kind} />}
        </PageHeader>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="card overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wider text-ink-2">
                <tr>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Born</th>
                  <th className="px-4 py-3">Status</th>
                  {canEdit && <th className="px-4 py-3"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {h.members.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center">
                      <p className="font-semibold">No members yet</p>
                      <p className="mt-1 text-[14px] text-ink-2">{canEdit ? `Search the member directory on the right and add them, starting with the ${relationLabel(kind, "HEAD").toLowerCase()}.` : `Members added to this ${k.one} will appear here.`}</p>
                    </td>
                  </tr>
                )}
                {h.members.map((row) => {
                  const m = row.member;
                  const name = `${m.lastName}, ${m.firstName}`;
                  return (
                    <tr key={m.id} className="border-t border-line align-top">
                      <td className="px-4 py-2.5">
                        <Link href={`/members/${m.id}?tab=family`} className="whitespace-nowrap font-semibold hover:underline">{name}</Link>
                        <span className="mono block text-[12px] text-ink-3">{m.memberId}</span>
                        
                      </td>
                      <td className="px-4 py-2.5">
                        {canEdit ? <RelationSelect kind={kind} householdId={h.id} memberId={m.id} relation={row.relation} label={name} hasOtherHead={Boolean(head && head.memberId !== m.id)} /> : relationLabel(kind, row.relation)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">{formatDob(m.dobPrecision, m.dobDate, m.dobYear) ?? "—"}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={m.status} /></td>
                      {canEdit && <td className="px-4 py-2.5 text-right"><RemoveFromHousehold householdId={h.id} memberId={m.id} label={name} /></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          {canEdit && (
            <aside className="card h-fit p-5">
              <h2 className="mb-1 text-[17px] font-semibold">Add a member</h2>
              <p className="mb-4 text-[13px] text-ink-2">Search by name or member ID. Each member can be in one {k.one}.</p>
              <AddHouseholdMember kind={kind} householdId={h.id} hasHead={Boolean(head)} memberIds={h.members.map((x) => x.member.id)} />
            </aside>
          )}
        </div>
      </main>
    </>
  );
}
