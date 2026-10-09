import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { HouseholdKind } from "@/generated/prisma/client";
import { AddHouseholdMember, NewCell, NewFamily, RelationSelect, RemoveFromHousehold, RenameHousehold } from "@/components/groups/group-widgets";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { StatusBadge } from "@/components/ui/badges";
import { formatDob } from "@/lib/dob";
import { MARITAL_LABELS } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getHousehold, KINDS, listHouseholds, relationLabel, spouseHouseholdSuggestions } from "@/server/households/service";

const INTRO: Record<HouseholdKind, string> = {
  FAMILY: "Church families — husband, wife, children and dependants — linked to their member records.",
  CELL: "Cell groups with their leader and members. A member can be in one family and one cell.",
};

/** Families or Cells list page. */
export async function HouseholdList({ kind, q }: { kind: HouseholdKind; q?: string }) {
  const ctx = await requirePermission("household", "read");
  if (!can(ctx, "member.sensitive", "read")) redirect("/denied?need=member.sensitive:read");
  const k = KINDS[kind];
  const canEdit = can(ctx, "household", "update");
  const [{ total, rows }, suggestions] = await Promise.all([
    listHouseholds(db, ctx, kind, q ?? ""),
    kind === "FAMILY" && canEdit ? spouseHouseholdSuggestions(db, ctx, 5) : Promise.resolve([]),
  ]);
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
                <input id="hh-search" name="q" defaultValue={q} className="input max-w-md" placeholder={kind === "FAMILY" ? "Family name, or a husband, wife or child’s name" : "Cell name or member name"} type="search" />
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
                  const spouse = h.members.find((m) => m.relation === "SPOUSE")?.member;
                  const children = h.members.filter((m) => m.relation === "CHILD").length;
                  const others = h.members.length - (head ? 1 : 0) - (spouse ? 1 : 0) - children;
                  return (
                    <li key={h.id}>
                      <Link href={`${k.path}/${h.id}`} className="card flex h-full flex-col p-4 transition-colors hover:border-primary">
                        <span className="flex items-start justify-between gap-3">
                          <span className="text-[16px] font-semibold leading-snug">{h.name}</span>
                          <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[12px] font-semibold text-primary">{h.members.length}</span>
                        </span>
                        {kind === "FAMILY" ? (
                          <span className="mt-2 space-y-0.5 text-[13px] text-ink-2">
                            <span className="block">{relationLabel(kind, "HEAD").split(" /")[0]}: <span className="text-ink">{head ? `${head.firstName} ${head.lastName}` : "—"}</span></span>
                            <span className="block">{relationLabel(kind, "SPOUSE").split(" /")[0]}: <span className="text-ink">{spouse ? `${spouse.firstName} ${spouse.lastName}` : "—"}</span></span>
                            <span className="block">{children} child{children === 1 ? "" : "ren"}{others > 0 && ` · ${others} other${others === 1 ? "" : "s"}`}</span>
                          </span>
                        ) : (
                          <span className="mt-2 space-y-0.5 text-[13px] text-ink-2">
                            <span className="block">Leader: <span className="text-ink">{head ? `${head.firstName} ${head.lastName}` : "Not set"}</span></span>
                            <span className="block">{h.members.length - (head ? 1 : 0)} member{h.members.length - (head ? 1 : 0) === 1 ? "" : "s"}</span>
                          </span>
                        )}
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
                <p className="mb-4 text-[13px] text-ink-2">{kind === "FAMILY" ? "Search the member directory for the husband and wife. Children and others can be added next." : "Name the cell and, if known, its leader."}</p>
                {kind === "FAMILY" ? <NewFamily /> : <NewCell />}
              </section>
            )}
            {suggestions.length > 0 && (
              <section className="card p-5">
                <h2 className="text-[17px] font-semibold">Married couples without a family</h2>
                <p className="mt-1 text-[13px] text-ink-2">Linked as spouses on their records but not yet in a family.</p>
                <ul className="mt-4 space-y-4">
                  {suggestions.map((s) => {
                    const [head, spouse] = s.gender === "FEMALE" || s.spouse!.gender === "MALE" ? [s.spouse!, s] : [s, s.spouse!];
                    return (
                      <li key={s.id} className="rounded-[8px] border border-line p-3">
                        <NewFamily suggestion={{ head, spouse }} />
                      </li>
                    );
                  })}
                </ul>
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
  const hasSpouse = h.members.some((m) => m.relation === "SPOUSE");
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
                  {kind === "FAMILY" && <th className="px-4 py-3">Next of kin</th>}
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
                  const spouseLinked = head && row.relation === "SPOUSE" && m.spouseMemberId === head.memberId;
                  return (
                    <tr key={m.id} className="border-t border-line align-top">
                      <td className="px-4 py-2.5">
                        <Link href={`/members/${m.id}?tab=family`} className="whitespace-nowrap font-semibold hover:underline">{name}</Link>
                        <span className="mono block text-[12px] text-ink-3">{m.memberId}</span>
                        {m.maritalStatus && <span className="block text-[12px] text-ink-2">{MARITAL_LABELS[m.maritalStatus]}{spouseLinked ? " · spouse linked" : ""}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {canEdit ? <RelationSelect kind={kind} householdId={h.id} memberId={m.id} relation={row.relation} label={name} hasOtherHead={Boolean(head && head.memberId !== m.id)} /> : relationLabel(kind, row.relation)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">{formatDob(m.dobPrecision, m.dobDate, m.dobYear) ?? "—"}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={m.status} /></td>
                      {kind === "FAMILY" && <td className="px-4 py-2.5">{m.nextOfKinName ? `${m.nextOfKinName}${m.nextOfKinPhoneRaw ? ` · ${m.nextOfKinPhoneRaw}` : ""}` : "—"}</td>}
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
              <AddHouseholdMember kind={kind} householdId={h.id} hasHead={Boolean(head)} hasSpouse={hasSpouse} memberIds={h.members.map((x) => x.member.id)} />
            </aside>
          )}
        </div>
      </main>
    </>
  );
}
