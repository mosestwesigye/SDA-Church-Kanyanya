import type { Metadata } from "next";
import Link from "next/link";
import { BarList, Donut, StackedBar, type Datum } from "@/components/dashboard/charts";
import { NavIcon } from "@/components/shell/nav-icons";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { formatDate, NOT_RECORDED, STATUS_META, type StatusKey } from "@/lib/labels";
import { can } from "@/server/authz/policy";
import { requireContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { dashboardStats, recentActivity, upcomingBirthdays } from "@/server/dashboard/stats";
import { REQUEST_TYPES } from "@/server/workflows/status";

export const metadata: Metadata = { title: "Dashboard" };

function greeting(now: Date) {
  const h = Number(now.toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Kampala" }));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const fmt = (n: number) => n.toLocaleString("en-UG");

function Card({ title, subtitle, action, badge, children, className = "" }: { title: string; subtitle?: string; action?: { href: string; label: string }; badge?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card flex flex-col ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold leading-tight">{title}</h2>
          {subtitle && <p className="mt-1 text-[13px] text-ink-2">{subtitle}</p>}
        </div>
        {badge}
      </header>
      <div className="flex-1 px-5 py-4">{children}</div>
      {action && (
        <footer className="border-t border-line px-5 py-3">
          <Link href={action.href} className="inline-flex min-h-[28px] items-center gap-1 text-[13px] font-semibold text-primary hover:underline">
            {action.label} <span aria-hidden>→</span>
          </Link>
        </footer>
      )}
    </section>
  );
}

function WarnBadge({ children }: { children: React.ReactNode }) {
  return <span className="shrink-0 rounded-full bg-error-soft px-2 py-0.5 text-[12px] font-semibold text-error">{children}</span>;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ zone?: string }> }) {
  const ctx = await requireContext();
  const { zone } = await searchParams;
  const now = new Date();
  const firstName = ctx.label.split(" ")[0];
  const nextQuarterDue = (() => {
    const q = Math.floor(now.getUTCMonth() / 3);
    return new Date(Date.UTC(now.getUTCFullYear(), q * 3 + 3, 10)).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  })();
  const dateLine = `${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Kampala" })} · Q${Math.floor(now.getUTCMonth() / 3) + 1} clerk’s report due ${nextQuarterDue}`;

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

  const [s, birthdays, activity, pending, corrections] = await Promise.all([
    dashboardStats(db, ctx, { zoneId: zone }),
    upcomingBirthdays(db, ctx, 7, 5),
    recentActivity(db, ctx, 5),
    can(ctx, "transfer", "read") ? db.statusChangeRequest.groupBy({ by: ["type"], where: { state: "PENDING" }, _count: true }) : null,
    can(ctx, "correction_request", "review") ? db.correctionRequest.count({ where: { state: "PENDING" } }) : null,
  ]);
  const pendingTotal = pending?.reduce((n, p) => n + p._count, 0) ?? 0;
  const active = s.status.find((x) => x.key === "ACTIVE")?.n ?? 0;
  const pct = s.complete !== null && s.total ? Math.round((s.complete / s.total) * 100) : 0;

  const statusData: Datum[] = s.status.map((x) => ({
    key: x.key,
    label: x.key === "NONE" ? NOT_RECORDED.label : STATUS_META[x.key as StatusKey].label,
    n: x.n,
    color: x.key === "NONE" ? NOT_RECORDED.color : STATUS_META[x.key as StatusKey].color,
  }));
  const genderData: Datum[] = [
    { key: "F", label: "Female", n: s.gender[0].n, color: "var(--primary)" },
    { key: "M", label: "Male", n: s.gender[1].n, color: "var(--accent)" },
    { key: "N", label: "Not recorded", n: s.gender[2].n, color: "var(--line)" },
  ];
  const ageData: Datum[] = [
    ...s.ages.map((a) => ({ key: a.key, label: a.key, n: a.n, color: "var(--primary)" })),
    { key: "unknown", label: "Unknown", n: s.unknownAge, color: "var(--error)" },
  ];
  const zoneData: Datum[] = s.zones.map((z) => ({ key: z.key ?? "none", label: z.key ?? "Not recorded", n: z.n, color: z.key === "Not recorded" ? "var(--error)" : "var(--primary)" }));
  const ministryData: Datum[] = s.ministries.slice(0, 8).map((m) => ({ key: m.key, label: m.key, n: m.n, color: "var(--primary)" }));

  return (
    <>
      <TopBar showAdd={can(ctx, "member", "create")} />
      <main className="p-4 md:p-7">
        <PageHeader title={`${greeting(now)}, ${firstName}`} subtitle={dateLine}>
          {s.profile && (
            <form className="flex gap-2" action="/dashboard">
              <label htmlFor="zone-filter" className="sr-only">Zone</label>
              <select id="zone-filter" name="zone" defaultValue={zone ?? ""} className="h-9 rounded-[6px] border border-line bg-surface px-3 text-[13px]">
                <option value="">All zones</option>
                {s.zoneOptions.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
              </select>
              <button className="h-9 rounded-[6px] border border-line bg-surface px-3 text-[13px]">Apply</button>
              <span className="hidden h-9 items-center rounded-[6px] border border-line bg-surface px-3 text-[13px] sm:inline-flex">As of today</span>
            </form>
          )}
        </PageHeader>

        {/* Row 1: headline tiles */}
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Summary">
          {s.complete !== null && (
            <div className="rounded-[10px] bg-[var(--hero)] p-5 text-[var(--hero-ink)]">
              <div className="text-[13px] font-medium opacity-90">Profile completeness</div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-[40px] font-semibold leading-none tracking-[-0.02em]">{pct}%</span>
                <span className="text-[13px] opacity-90">{fmt(s.complete)} of {fmt(s.total)} complete</span>
              </div>
              <div className="mt-4 h-1.5 rounded-full bg-white/25" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Complete profiles">
                <div className="h-full rounded-full bg-white" style={{ width: `${Math.max(pct, 1)}%` }} />
              </div>
              <div className="mt-4 flex items-center justify-between gap-3 text-[13px]">
                <span>{fmt(s.nameOnly ?? 0)} have only name and ID</span>
                {can(ctx, "cleanup", "use") && (
                  <Link href="/cleanup" className="shrink-0 whitespace-nowrap rounded-[5px] bg-white px-3 py-[7px] font-semibold text-[var(--sidebar)]">Start clean-up</Link>
                )}
              </div>
            </div>
          )}
          <Stat icon="members" label="Total membership" value={fmt(s.total)} note={s.profile ? `${fmt(active)} active · ${fmt(s.total - active)} other statuses` : "Members you can see"} href="/members" />
          {pending && (
            <Stat
              icon="transfers"
              label="Pending approvals"
              value={fmt(pendingTotal)}
              tone={pendingTotal ? "attention" : "clear"}
              note={pendingTotal ? pending.map((p) => `${p._count} ${REQUEST_TYPES[p.type].label.toLowerCase()}`).join(" · ") : "All caught up"}
              href="/transfers"
            />
          )}
          {corrections !== null && (
            <Stat
              icon="requests"
              label="Member requests"
              value={fmt(corrections)}
              tone={corrections ? "attention" : "clear"}
              note={corrections ? "Corrections waiting for review" : "No corrections waiting"}
              href="/self-service-requests"
            />
          )}
        </section>

        {/* Row 2: status, gender, age */}
        {s.profile && (
          <section className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1.3fr_1.3fr]">
            <Card title="Membership by status" subtitle={`${fmt(s.total)} records`} action={can(ctx, "report", "read") ? { href: "/reports/status", label: "Status report" } : undefined}>
              <StackedBar data={statusData} caption="Members by membership status" />
            </Card>
            <Card title="Gender" subtitle="All members">
              <Donut data={genderData} caption="Members by gender" />
            </Card>
            <Card title="Age band" subtitle="From date or year of birth" badge={s.unknownAge ? <WarnBadge>{fmt(s.unknownAge)} no DOB</WarnBadge> : undefined}>
              <BarList data={ageData} caption="Members by age band" labelWidth={76} />
            </Card>
          </section>
        )}

        {/* Row 3: zones, ministries, activity, birthdays */}
        <section className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {s.profile && (
            <Card title="Members by zone" subtitle="Top zones by members" action={can(ctx, "report", "read") ? { href: "/reports/zones", label: "Zone lists" } : undefined}>
              <BarList data={zoneData} caption="Members by zone" />
            </Card>
          )}
          <Card title="Ministries" subtitle={`Top ${Math.min(8, s.ministries.length)} of ${s.ministryCount} by members`} action={{ href: "/ministries", label: "All ministries" }}>
            {ministryData.length ? <BarList data={ministryData} caption="Members per ministry" labelWidth={110} /> : <p className="text-ink-2">No ministry links yet.</p>}
          </Card>
          {can(ctx, "audit", "read") && (
            <Card title="Recent activity" subtitle="Latest changes to records" action={{ href: "/admin/audit", label: "Audit log" }}>
              {activity.length === 0 ? (
                <p className="text-ink-2">No recent changes.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {activity.map((a) => (
                    <li key={a.id} className="flex gap-2.5 py-2.5 first:pt-0">
                      <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />
                      <span className="text-[14px]">
                        <span>
                          {a.actorLabel} {activityVerb(a.action, a.entity, a.field)}{" "}
                          {a.member && <Link className="font-semibold hover:underline" href={`/members/${a.member.id}`}>{a.member.memberId}</Link>}
                        </span>
                        <span className="block text-[13px] text-ink-2">{a.source.toLowerCase().replace("_", "-")} · {formatDate(a.at)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {s.profile && (
            <Card title="Upcoming birthdays" subtitle="Next 7 days" action={can(ctx, "report", "read") ? { href: "/reports/birthdays", label: "Birthday list" } : undefined}>
              {birthdays.length === 0 ? (
                <p className="text-ink-2">No birthdays in the next 7 days.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {birthdays.map((b) => (
                    <li key={b.id} className="flex items-center gap-4 py-2.5 first:pt-0">
                      <span className="w-9 text-center leading-tight">
                        <span className="block text-[18px] font-semibold">{b.day}</span>
                        <span className="block text-[11px] text-ink-2">{b.month}</span>
                      </span>
                      <Link href={`/members/${b.id}`} className="min-w-0">
                        <span className="block truncate font-semibold hover:underline">{b.name}</span>
                        <span className="block truncate text-[13px] text-ink-2">Turns {b.turns}{b.ministry ? ` · ${b.ministry}` : ""}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[12px] text-ink-3">Members with only a birth year aren’t listed.</p>
            </Card>
          )}
        </section>
      </main>
    </>
  );
}

function activityVerb(action: string, entity: string, field: string | null) {
  if (entity === "StatusChangeRequest") return action === "APPROVE" ? "approved a status change for" : action === "REJECT" ? "rejected a status change for" : "requested a status change for";
  if (action === "CREATE") return "added";
  if (action === "MERGE") return "merged a duplicate into";
  if (action === "DELETE") return "deleted";
  if (action === "RESTORE") return "restored";
  if (action === "PURGE") return "purged";
  const f: Record<string, string> = { phoneE164: "phone", zoneId: "zone", professionId: "profession", dobDate: "date of birth", dobYear: "date of birth", status: "status", photoKey: "photo" };
  return `updated ${f[field ?? ""] ?? field ?? "the record"} for`;
}

function Stat({ label, value, note, href, icon, tone = "default" }: { label: string; value: string; note: string; href?: string; icon: string; tone?: "default" | "attention" | "clear" }) {
  const chip = tone === "attention" ? "bg-[color-mix(in_oklab,var(--status-irregular)_16%,transparent)] text-[var(--status-irregular)]" : tone === "clear" ? "bg-[color-mix(in_oklab,var(--ok)_14%,transparent)] text-ok" : "bg-primary-soft text-primary";
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        <span aria-hidden className={`grid size-9 place-items-center rounded-[8px] ${chip}`}>
          <NavIcon name={icon} className="size-[18px]" />
        </span>
        <span className="text-[13px] font-medium text-ink-2">{label}</span>
      </div>
      <div className="mt-4 text-[32px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{value}</div>
      <div className="mt-2 flex items-center gap-1.5 text-[13px] text-ink-2">
        {tone === "clear" && <span aria-hidden className="text-ok">✓</span>}
        {note}
      </div>
      {href && <span className="mt-auto pt-4 text-[13px] font-semibold text-primary group-hover:underline">Open <span aria-hidden>→</span></span>}
    </>
  );
  return href ? (
    <Link href={href} className="card group flex flex-col p-5 transition-colors hover:border-primary/60">{body}</Link>
  ) : (
    <div className="card flex flex-col p-5">{body}</div>
  );
}
