import type { Metadata } from "next";
import Link from "next/link";
import { BarList, Donut, StackedBar, type Datum } from "@/components/dashboard/charts";
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

function Card({ title, aside, children, className = "" }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card p-5 ${className}`}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {aside && <span className="text-[13px] text-ink-2">{aside}</span>}
      </div>
      {children}
    </section>
  );
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
              <div className="flex justify-between gap-2 text-[13px]">
                <span>Profile completeness</span>
                <span>{fmt(s.complete)} of {fmt(s.total)} complete</span>
              </div>
              <div className="mt-3 text-[40px] font-semibold leading-none">{pct}%</div>
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
          <Stat label="Total membership" value={fmt(s.total)} note={s.profile ? `${fmt(active)} active · ${fmt(s.total - active)} other statuses` : "Members you can see"} />
          {pending && (
            <Stat
              label="Pending approvals"
              value={fmt(pendingTotal)}
              note={pendingTotal ? pending.map((p) => `${p._count} ${REQUEST_TYPES[p.type].label.toLowerCase()}`).join(" · ") : "Nothing waiting"}
              href="/transfers"
            />
          )}
          {corrections !== null && <Stat label="Correction requests" value={fmt(corrections)} note="From member self-service" href="/self-service-requests" />}
        </section>

        {/* Row 2: status, gender, age */}
        {s.profile && (
          <section className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1.3fr_1.3fr]">
            <Card title="Membership by status" aside={`${fmt(s.total)} records`}>
              <StackedBar data={statusData} caption="Members by membership status" />
            </Card>
            <Card title="Gender">
              <Donut data={genderData} caption="Members by gender" />
            </Card>
            <Card title="Age band" aside={<span className="text-error">{fmt(s.unknownAge)} no DOB</span>}>
              <BarList data={ageData} caption="Members by age band" labelWidth={76} />
            </Card>
          </section>
        )}

        {/* Row 3: zones, ministries, activity, birthdays */}
        <section className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {s.profile && (
            <Card title="Members by zone">
              <BarList data={zoneData} caption="Members by zone" />
            </Card>
          )}
          <Card title="Members per ministry" aside={`Top ${Math.min(8, s.ministries.length)} of ${s.ministryCount}`}>
            {ministryData.length ? <BarList data={ministryData} caption="Members per ministry" labelWidth={110} /> : <p className="text-ink-2">No ministry links yet.</p>}
          </Card>
          {can(ctx, "audit", "read") && (
            <Card title="Recent activity" aside={can(ctx, "audit", "read") ? <Link href="/admin/audit" className="font-semibold text-primary">Audit log</Link> : undefined}>
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
            <Card title="Upcoming birthdays" aside="7 days">
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
              <p className="mt-3 text-[12px] text-ink-3">Members with year-only DOB are excluded.</p>
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

function Stat({ label, value, note, href }: { label: string; value: string; note: string; href?: string }) {
  const body = (
    <>
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className="mt-2 text-[34px] font-semibold leading-none">{value}</div>
      <div className="mt-3 text-[13px] text-ink-2">{note}</div>
    </>
  );
  return href ? (
    <Link href={href} className="card block p-5 hover:border-primary">{body}</Link>
  ) : (
    <div className="card p-5">{body}</div>
  );
}
