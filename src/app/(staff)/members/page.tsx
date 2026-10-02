import type { Metadata } from "next";
import Link from "next/link";
import { DirectoryClient } from "@/components/members/directory-client";
import { COLUMNS, DEFAULT_COLUMNS, type ColumnKey, type DirRow } from "@/components/members/types";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { formatDob } from "@/lib/dob";
import { MARITAL_LABELS, STATUS_KEYS, STATUS_META, type StatusKey } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { can, selectableGroups } from "@/server/authz/policy";
import { db } from "@/server/db";
import { countWhere, listMembers, PAGE_SIZE, parseDirectoryQuery } from "@/server/members/directory";

export const metadata: Metadata = { title: "Members" };

type Sp = Record<string, string | string[] | undefined>;

export default async function MembersPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const ctx = await requirePermission("member", "read");
  const sp = await searchParams;
  const query = parseDirectoryQuery(sp);
  const colsParam = typeof sp.cols === "string" ? sp.cols.split(",") : null;
  const columns = (colsParam ?? DEFAULT_COLUMNS).filter((c): c is ColumnKey => COLUMNS.some((x) => x.key === c));

  const readable = selectableGroups(ctx) as string[];
  const canProfile = readable.includes("member.profile");

  const [{ rows, total, pages }, lists, views, counts, flaggedIds] = await Promise.all([
    listMembers(db, ctx, query),
    db.listItem.findMany({ where: { active: true, mergedIntoId: null }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }], select: { id: true, type: true, label: true } }),
    db.savedView.findMany({ where: { OR: [{ userId: ctx.userId }, { shared: true }] }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    Promise.all([
      countWhere(db, ctx, {}),
      canProfile ? countWhere(db, ctx, { status: ["ACTIVE"] }) : Promise.resolve(null),
      canProfile ? countWhere(db, ctx, { profile: "incomplete" }) : Promise.resolve(null),
      can(ctx, "member", "restore") ? countWhere(db, ctx, { deleted: "1" }) : Promise.resolve(null),
      can(ctx, "cleanup", "use") ? countWhere(db, ctx, { flagged: "1" }) : Promise.resolve(null),
    ]),
    can(ctx, "cleanup", "use")
      ? db.reviewFlag.findMany({ where: { resolvedAt: null }, select: { memberId: true } }).then((f) => new Set(f.map((x) => x.memberId)))
      : Promise.resolve(new Set<string>()),
  ]);
  const [all, active, incomplete, deleted, flagged] = counts;
  const byType = (t: string) => lists.filter((l) => l.type === t).map((l) => ({ id: l.id, label: l.label }));

  // Saved views: count each one's matches.
  const viewTabs = await Promise.all(
    views.map(async (v) => {
      const search = String((v.filters as { search?: string })?.search ?? "");
      const params = Object.fromEntries(new URLSearchParams(search));
      const cols = v.columns.length ? `cols=${v.columns.join(",")}` : "";
      const href = `/members?${[search, cols, `view=${v.id}`].filter(Boolean).join("&")}`;
      return { label: v.name, count: await countWhere(db, ctx, parseDirectoryQuery(params)), href, active: sp.view === v.id, viewId: v.id, own: v.userId === ctx.userId };
    }),
  );
  const isPlain = (keys: string[]) => !sp.view && Object.keys(sp).filter((k) => !["page", "sort", "dir", "cols", "q"].includes(k)).every((k) => keys.includes(k));
  const tabs = [
    { label: "All members", count: all, href: "/members", active: isPlain([]) },
    ...(active !== null ? [{ label: "Active", count: active, href: "/members?status=ACTIVE", active: isPlain(["status"]) && sp.status === "ACTIVE" }] : []),
    ...(incomplete !== null ? [{ label: "Incomplete profiles", count: incomplete, href: "/members?profile=incomplete", active: isPlain(["profile"]) && sp.profile === "incomplete" }] : []),
    ...(flagged ? [{ label: "In clean-up queue", count: flagged, href: "/members?flagged=1", active: isPlain(["flagged"]) && sp.flagged === "1" }] : []),
    ...viewTabs,
    ...(deleted !== null ? [{ label: "Recently deleted", count: deleted, href: "/members?deleted=1", active: sp.deleted === "1" }] : []),
  ].map((t) => ({ ...t, active: t.active && !(sp.view && !("viewId" in t)) }));

  const dirRows: DirRow[] = rows.map((r) => {
    const m = r as unknown as Record<string, unknown> & {
      ministries?: { ministry?: { label: string }; role?: { label: string } }[];
      zone?: { label: string } | null;
      profession?: { label: string } | null;
    };
    const links = m.ministries ?? [];
    return {
      id: r.id,
      memberId: r.memberId,
      lastName: r.lastName,
      firstName: r.firstName,
      status: (m.status as StatusKey | null) ?? null,
      gender: (m.gender as DirRow["gender"]) ?? null,
      dob: m.dobPrecision ? formatDob(m.dobPrecision as "FULL" | "YEAR" | "UNKNOWN", (m.dobDate as Date | null) ?? null, (m.dobYear as number | null) ?? null)?.replace(" (year only)", " (yr)") ?? null : null,
      zone: m.zone?.label ?? null,
      phone: (m.phoneRaw as string | null) ?? null,
      email: (m.email as string | null) ?? null,
      ministry: links.length ? links.map((l) => `${l.ministry?.label} · ${l.role?.label}`).join(", ") : null,
      completeness: (m.completeness as number | undefined) ?? null,
      marital: m.maritalStatus ? MARITAL_LABELS[m.maritalStatus as keyof typeof MARITAL_LABELS] : null,
      yearJoined: (m.yearJoined as number | null) ?? null,
      profession: m.profession?.label ?? null,
      nextOfKin: (m.nextOfKinName as string | null) ?? null,
      updatedAt: (m.updatedAt as Date).toISOString(),
      deleted: Boolean(m.deletedAt),
      flagged: flaggedIds.has(r.id),
      restricted: r.restricted,
    };
  });

  return (
    <>
      <TopBar showAdd={can(ctx, "member", "create")} />
      <main className="p-4 md:p-7">
        <PageHeader
          title="Members"
          subtitle={`${all.toLocaleString("en-UG")} records${deleted ? ` · ${deleted} in Recently deleted` : ""}`}
        >
          {can(ctx, "import", "run") && <Link href="/import" className="btn btn-secondary hidden md:inline-flex">Import</Link>}
          {can(ctx, "member", "create") && (
            <Link
              href="/members/new"
              className="md:hidden fixed right-4 bottom-[84px] z-20 inline-flex min-h-[52px] items-center rounded-full bg-primary px-5 text-[16px] font-semibold text-primary-ink shadow-lg"
            >
              + Add
            </Link>
          )}
        </PageHeader>
        <DirectoryClient
          rows={dirRows}
          total={total}
          page={query.page}
          pages={pages}
          pageSize={PAGE_SIZE}
          columns={columns}
          readableGroups={readable}
          tabs={tabs}
          deletedView={query.deleted === "1"}
          options={{
            statuses: [...STATUS_KEYS.map((s) => ({ id: s, label: STATUS_META[s].label })), { id: "NONE", label: "Not recorded" }],
            ministries: byType("MINISTRY"),
            zones: [...byType("ZONE"), { id: "NONE", label: "Not recorded" }],
            roles: byType("MINISTRY_ROLE"),
            marital: [...Object.entries(MARITAL_LABELS).map(([id, label]) => ({ id, label })), { id: "NONE", label: "Not recorded" }],
          }}
          caps={{
            bulkUpdate: can(ctx, "member", "update") && can(ctx, "member.profile", "update"),
            del: can(ctx, "member", "delete"),
            flag: can(ctx, "cleanup", "use"),
            exportRun: can(ctx, "export", "run"),
            restore: can(ctx, "member", "restore"),
            manageMinistry: can(ctx, "member", "update") || can(ctx, "ministry", "manage"),
            filterProfile: canProfile,
            filterSensitive: can(ctx, "member.sensitive", "read"),
            shareView: can(ctx, "admin.lists", "manage"),
          }}
        />
      </main>
    </>
  );
}
