import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { can, memberScopeWhere } from "@/server/authz/policy";
import { requireContext } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Dashboard" };

function greeting(now: Date) {
  const h = Number(now.toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Kampala" }));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage() {
  const ctx = await requireContext();
  const now = new Date();
  const firstName = ctx.label.split(" ")[0];
  const dateLine = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Kampala" });

  if (!can(ctx, "member", "read")) {
    return (
      <>
        <TopBar />
        <main className="p-4 md:p-7">
          <PageHeader title={`${greeting(now)}, ${firstName}`} subtitle={dateLine} />
        </main>
      </>
    );
  }

  const where = { AND: [memberScopeWhere(ctx), { deletedAt: null, mergedIntoId: null }] };
  const [total, complete, nameOnly, avg, pending, corrections] = await Promise.all([
    db.member.count({ where }),
    db.member.count({ where: { AND: [where, { completeness: 100 }] } }),
    db.member.count({ where: { AND: [where, { completeness: { lte: 14 } }] } }),
    db.member.aggregate({ where, _avg: { completeness: true } }),
    can(ctx, "transfer", "read") ? db.statusChangeRequest.count({ where: { state: "PENDING" } }) : null,
    can(ctx, "correction_request", "review") ? db.correctionRequest.count({ where: { state: "PENDING" } }) : null,
  ]);
  const pct = total ? Math.round((complete / total) * 100) : 0;
  const avgPct = Math.round(avg._avg.completeness ?? 0);
  const fmt = (n: number) => n.toLocaleString("en-UG");

  return (
    <>
      <TopBar showAdd={can(ctx, "member", "create")} />
      <main className="p-4 md:p-7">
        <PageHeader title={`${greeting(now)}, ${firstName}`} subtitle={dateLine} />
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Summary">
          <div className="rounded-[10px] bg-primary text-primary-ink p-5">
            <div className="flex justify-between text-[13px]">
              <span>Profile completeness</span>
              <span>
                {fmt(complete)} of {fmt(total)} complete
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-[40px] font-semibold leading-none">{pct}%</span>
              <span className="text-[13px] opacity-85">average record {avgPct}% filled</span>
            </div>
            <div className="mt-4 h-1.5 rounded-full bg-white/25" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Complete profiles">
              <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 text-[13px]">
              <span>{fmt(nameOnly)} have only name and ID</span>
              {can(ctx, "cleanup", "use") && (
                <Link href="/cleanup" className="shrink-0 whitespace-nowrap rounded-[5px] bg-white text-[var(--sidebar)] font-semibold px-3 py-[7px]">
                  Start clean-up
                </Link>
              )}
            </div>
          </div>
          <Stat label="Total membership" value={fmt(total)} note="Excludes deleted and merged records" />
          {pending !== null && <Stat label="Pending approvals" value={fmt(pending)} note="Transfers and status changes" />}
          {corrections !== null && <Stat label="Correction requests" value={fmt(corrections)} note="From member self-service" />}
        </section>
      </main>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card p-5">
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className="text-[32px] font-semibold mt-2 leading-none">{value}</div>
      <div className="text-[13px] text-ink-2 mt-3">{note}</div>
    </div>
  );
}
