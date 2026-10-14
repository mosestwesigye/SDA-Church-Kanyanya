import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DormantTable, type DormantRow } from "@/components/dormant/dormant-table";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { EmptyState } from "@/components/ui/states";
import { requirePermission } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { db } from "@/server/db";
import { DORMANT_TABS, dormantCounts, listDormant } from "@/server/members/dormant";
import { canChangeStatus } from "@/server/workflows/status";

export const metadata: Metadata = { title: "Dormant members" };

const TAB_NOTES: Record<string, string> = {
  all: "Everyone not Active or Irregular, except the deceased.",
  none: "No status recorded yet. Select several to update them together.",
  dormant: "Members recorded as dormant (not attending). Mark them Active or Irregular when they return.",
  missing: "Members whose whereabouts are unknown (reported as Missing to the Conference). Mark them Active or Irregular when they are found.",
  self: "Members recorded as self transferred. Mark them Active or Irregular when they return.",
  discipline: "Members under church discipline. Marking one Active records a restoration.",
  left: "Members recorded as having left the faith. Mark them Active or Irregular when they return.",
  deceased: "Kept for the record only; they are never counted.",
};

export default async function DormantPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; zone?: string; page?: string }> }) {
  const ctx = await requirePermission("member", "read");
  if (!can(ctx, "member.profile", "read")) redirect("/denied?need=member.profile:read");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [counts, list, zones] = await Promise.all([
    dormantCounts(db, ctx),
    listDormant(db, ctx, { tab: sp.tab, q: sp.q, zone: sp.zone, page }),
    db.listItem.findMany({ where: { type: "ZONE", active: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }], select: { id: true, label: true } }),
  ]);
  const canActivate = can(ctx, "member.profile", "update") && can(ctx, "member", "update");
  const canChange = canChangeStatus(ctx);
  const href = (o: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { tab: list.tab === "all" ? undefined : list.tab, q: sp.q, zone: sp.zone, ...o };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "" && !(k === "page" && Number(v) === 1)) p.set(k, String(v));
    const s = p.toString();
    return `/dormant${s ? `?${s}` : ""}`;
  };
  const rows: DormantRow[] = list.rows.map((r) => {
    const x = r as unknown as Record<string, unknown> & { id: string; memberId: string; lastName: string; firstName: string };
    return {
      id: x.id,
      memberId: x.memberId,
      name: `${x.lastName}, ${x.firstName}`,
      status: (x.status as string | null) ?? null,
      zone: (x.zone as { label: string } | null | undefined)?.label ?? null,
      phone: (x.phoneRaw as string | null | undefined) ?? null,
      completeness: typeof x.completeness === "number" ? x.completeness : null,
      pendingTo: (x.pendingTo as string | null) ?? null,
    };
  });

  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7">
        <PageHeader
          title="Dormant members"
          subtitle="Members who are not Active or Irregular. They are left out of the dashboard and reports until their status is updated here."
        />

        <nav aria-label="Dormant groups" className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
          {DORMANT_TABS.map((t) => {
            const on = list.tab === t.key;
            return (
              <Link
                key={t.key}
                href={href({ tab: t.key === "all" ? undefined : t.key, page: 1 })}
                aria-current={on ? "page" : undefined}
                className={`flex min-h-[40px] shrink-0 items-center gap-2 rounded-full border px-3.5 text-[14px] ${on ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface hover:border-primary/60"}`}
              >
                {t.label}
                <span className={`rounded-full px-1.5 text-[12px] font-semibold tabular-nums ${on ? "bg-white/20" : "bg-surface-2 text-ink-2"}`}>{counts[t.key].toLocaleString("en-UG")}</span>
              </Link>
            );
          })}
        </nav>

        <div className="card mb-4 flex flex-wrap items-end justify-between gap-3 p-4">
          <p className="max-w-xl text-[14px] text-ink-2">{TAB_NOTES[list.tab]}</p>
          <form action="/dormant" className="flex flex-wrap items-end gap-2" role="search">
            {list.tab !== "all" && <input type="hidden" name="tab" value={list.tab} />}
            <div>
              <label htmlFor="d-q" className="field-label">Search</label>
              <input id="d-q" name="q" defaultValue={sp.q} type="search" className="input h-10 w-56" placeholder="Name, ID or phone" />
            </div>
            <div>
              <label htmlFor="d-zone" className="field-label">Zone</label>
              <select id="d-zone" name="zone" defaultValue={sp.zone ?? ""} className="input h-10 py-0">
                <option value="">All zones</option>
                {zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
                <option value="NONE">Not recorded</option>
              </select>
            </div>
            <button className="btn btn-secondary">Apply</button>
          </form>
        </div>

        {rows.length === 0 ? (
          <EmptyState title={sp.q || sp.zone ? "No dormant members match" : "Nobody here"}>
            {sp.q || sp.zone ? "Try another search or zone." : "Every member in this group has been updated."}
          </EmptyState>
        ) : (
          <>
            <DormantTable rows={rows} canActivate={canActivate} canChange={canChange} />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[14px] text-ink-2">
              <span>
                Showing {(list.page - 1) * 25 + 1}–{(list.page - 1) * 25 + rows.length} of {list.total.toLocaleString("en-UG")}
              </span>
              <span className="flex gap-2">
                {list.page > 1 && <Link className="btn btn-secondary" href={href({ page: list.page - 1 })}>Previous</Link>}
                {list.page < list.pages && <Link className="btn btn-secondary" href={href({ page: list.page + 1 })}>Next</Link>}
              </span>
            </div>
          </>
        )}
      </main>
    </>
  );
}
