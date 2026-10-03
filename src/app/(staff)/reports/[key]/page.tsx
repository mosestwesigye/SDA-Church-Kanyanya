import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DownloadReport, PrintButton } from "@/components/reports/report-actions";
import { TopBar } from "@/components/shell/topbar";
import { EmptyState } from "@/components/ui/states";
import { STATUS_KEYS, STATUS_META } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { listMinistries } from "@/server/ministries/service";
import { buildReport, isReportKey, parseReportParams, REPORTS, type Report, type ReportKey } from "@/server/reports/reports";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await params;
  return { title: isReportKey(key) ? REPORTS[key].title : "Report" };
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePermission("report", "read");
  const { key } = await params;
  if (!isReportKey(key)) notFound();
  const sp = await searchParams;
  const p = parseReportParams(key, sp);
  let report: Report;
  try {
    report = await buildReport(db, ctx, key, p);
  } catch (e) {
    if (e instanceof ForbiddenError) redirect("/denied?need=member.profile:read");
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const search = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();

  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7 print:p-0">
        <nav aria-label="Breadcrumb" className="mb-3 text-[14px] text-ink-2 print:hidden">
          <Link href="/reports" className="hover:underline">Reports</Link> / {REPORTS[key].title}
        </nav>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="hidden text-[12px] font-semibold uppercase tracking-wider text-primary print:block">Seventh-day Adventist Church Kanyanya</p>
            <h1 className="text-[24px] font-semibold leading-tight md:text-[28px]">{report.title}</h1>
            <p className="mt-1 text-ink-2">{report.subtitle}</p>
          </div>
          <div className="flex gap-2 print:hidden">
            <PrintButton />
            {can(ctx, "export", "run") && <DownloadReport reportKey={key} search={search ? `?${search}` : ""} title={report.title.toLowerCase()} />}
          </div>
        </div>

        <ParamsForm reportKey={key} p={p as Record<string, unknown>} ctx={ctx} />

        <p className="mb-5 text-[12px] text-ink-2">
          Generated {report.generatedAt.toLocaleString("en-GB", { timeZone: "Africa/Kampala", dateStyle: "medium", timeStyle: "short" })} by {report.generatedBy}. Contains personal data
          protected by the Data Protection and Privacy Act, 2019 — church administration only.
          {report.omitted.length > 0 && <> Columns not shown for your role: {report.omitted.join(", ")}.</>}
        </p>

        {report.sections.length === 0 ? (
          <EmptyState title="Choose what to report on">Pick the options above, then select Show.</EmptyState>
        ) : (
          <div className="space-y-5">
            {report.sections.map((s) => (
              <section key={s.heading} className="card p-5 print:p-0">
                <h2 className="mb-1 text-[17px] font-semibold">{s.heading}</h2>
                {s.note && <p className="mb-3 text-[13px] text-ink-2">{s.note}</p>}
                {s.summary && (
                  <dl className="mt-3 max-w-xl gap-x-8 sm:columns-2">
                    {s.summary.map((it) => (
                      <div key={it.label} className="flex break-inside-avoid justify-between gap-3 border-b border-line py-1.5 text-[15px]">
                        <dt>{it.label}</dt>
                        <dd className="font-semibold tabular-nums">{typeof it.value === "number" ? it.value.toLocaleString("en-UG") : it.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {s.table &&
                  (s.table.rows.length === 0 ? (
                    <p className="mt-2 text-ink-2">No members.</p>
                  ) : (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-[14px] print:text-[10px]">
                        <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wider text-ink-2">
                          <tr>{s.table.columns.map((c) => <th key={c.key} scope="col" className="px-3 py-2">{c.label}</th>)}</tr>
                        </thead>
                        <tbody>
                          {s.table.rows.map((r, i) => (
                            <tr key={i} className="border-t border-line align-top">
                              {s.table!.columns.map((c) => <td key={c.key} className="px-3 py-1.5">{String(r[c.key] ?? "")}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

async function ParamsForm({ reportKey, p, ctx }: { reportKey: ReportKey; p: Record<string, unknown>; ctx: Awaited<ReturnType<typeof requirePermission>> }) {
  const sel = "h-10 rounded-[6px] border border-line bg-surface px-3 text-[14px]";
  const zones = reportKey === "status" || reportKey === "zones" ? await db.listItem.findMany({ where: { type: "ZONE", active: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }) : [];
  const ministries = reportKey === "ministry-roster" ? await listMinistries(db, ctx) : [];
  const year = new Date().getUTCFullYear();
  const field = (id: string, label: string, control: React.ReactNode) => (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      {control}
    </div>
  );
  return (
    <form className="card mb-5 flex flex-wrap items-end gap-3 p-4 print:hidden" action={`/reports/${reportKey}`}>
      {reportKey === "quarterly" && (
        <>
          {field("r-year", "Year", (
            <select id="r-year" name="year" defaultValue={String(p.year)} className={sel}>
              {Array.from({ length: 6 }, (_, i) => year - i).map((y) => <option key={y}>{y}</option>)}
            </select>
          ))}
          {field("r-q", "Quarter", (
            <select id="r-q" name="quarter" defaultValue={String(p.quarter)} className={sel}>
              {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
            </select>
          ))}
        </>
      )}
      {reportKey === "status" &&
        field("r-status", "Status", (
          <select id="r-status" name="status" defaultValue={String(p.status ?? "")} className={sel}>
            <option value="">All statuses</option>
            {STATUS_KEYS.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            <option value="NONE">Not recorded</option>
          </select>
        ))}
      {(reportKey === "status" || reportKey === "zones") &&
        field("r-zone", "Zone", (
          <select id="r-zone" name="zone" defaultValue={String(p.zone ?? "")} className={sel}>
            <option value="">All zones</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
            <option value="NONE">Not recorded</option>
          </select>
        ))}
      {reportKey === "ministry-roster" &&
        field("r-ministry", "Ministry", (
          <select id="r-ministry" name="ministry" defaultValue={String(p.ministry ?? "")} className={sel} required>
            <option value="">Choose…</option>
            {ministries.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        ))}
      {reportKey === "birthdays" &&
        field("r-month", "Month", (
          <select id="r-month" name="month" defaultValue={String(p.month)} className={sel}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i + 1}>{new Date(Date.UTC(2000, i, 1)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" })}</option>
            ))}
          </select>
        ))}
      <button className="btn btn-secondary">Show</button>
    </form>
  );
}
