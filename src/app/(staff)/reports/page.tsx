import type { Metadata } from "next";
import Link from "next/link";
import { FormatChips, REPORT_META, ReportIcon } from "@/components/reports/report-meta";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { EmptyState } from "@/components/ui/states";
import { requirePermission } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { db } from "@/server/db";
import { availableReports, buildReport, isReportKey, REPORTS, type Report } from "@/server/reports/reports";

export const metadata: Metadata = { title: "Reports" };

const eat = (d: Date) => `${d.toLocaleString("en-GB", { timeZone: "Africa/Kampala", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} EAT`;

function figure(r: Report, heading: string, label: string) {
  const v = r.sections.find((s) => s.heading === heading)?.summary?.find((x) => x.label === label)?.value;
  return typeof v === "number" ? v : Number(v ?? 0);
}

/** The quarter in progress, the one most recently closed, and the date each report is due (10th of the following month). */
function quarters(now = new Date()) {
  const y = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  const due = (yy: number, qq: number) => new Date(Date.UTC(yy, qq * 3, 10));
  const prev = q === 1 ? { year: y - 1, quarter: 4 } : { year: y, quarter: q - 1 };
  const prevDue = due(prev.year, prev.quarter);
  return { current: { year: y, quarter: q, due: due(y, q) }, previous: { ...prev, due: prevDue, open: prevDue.getTime() >= now.getTime() } };
}

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default async function ReportsPage() {
  const ctx = await requirePermission("report", "read");
  const keys = availableReports(ctx);
  const canDownload = can(ctx, "export", "run");
  const { current, previous } = quarters();
  const [quarterly, recent] = await Promise.all([
    keys.includes("quarterly") ? buildReport(db, ctx, "quarterly", { year: current.year, quarter: current.quarter }) : null,
    canDownload ? db.exportLog.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: "desc" }, take: 6 }) : [],
  ]);
  const others = keys.filter((k) => k !== "quarterly");

  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7">
        <PageHeader title="Reports" subtitle="Official reports from the membership register. Preview on screen, print, or download as PDF or Excel." />

        {keys.length === 0 ? (
          <EmptyState title="No reports for your role">Reports need access to member profiles. Ask the Church Clerk if you need one.</EmptyState>
        ) : (
          <div className="space-y-7">
            {quarterly && (
              <section aria-labelledby="q-title" className="card overflow-hidden">
                <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                  <div className="relative overflow-hidden bg-sidebar p-6 text-sidebar-ink md:p-7">
                    <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-[radial-gradient(closest-side,rgb(127_196_206/0.25),transparent)]" />
                    <p className="relative inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#9fd6de] ring-1 ring-white/10">
                      <ReportIcon reportKey="quarterly" className="size-3.5" /> For Central Uganda Conference
                    </p>
                    <h2 id="q-title" className="relative mt-4 text-[24px] font-semibold leading-tight">Clerk’s quarterly report</h2>
                    <p className="relative mt-2 max-w-md text-[14px] text-sidebar-muted">{REPORTS.quarterly.description}</p>
                    <div className="relative mt-6 flex flex-wrap gap-2">
                      <Link href={`/reports/quarterly?year=${current.year}&quarter=${current.quarter}`} className="btn bg-white text-sidebar hover:bg-white/90">
                        Open Q{current.quarter} {current.year}
                      </Link>
                      <Link href={`/reports/quarterly?year=${previous.year}&quarter=${previous.quarter}`} className="btn border border-white/25 text-sidebar-ink hover:bg-white/10">
                        Q{previous.quarter} {previous.year}
                      </Link>
                    </div>
                    <p className="relative mt-4 text-[13px] text-sidebar-muted">
                      {previous.open ? <>Q{previous.quarter} {previous.year} report due <strong className="text-sidebar-ink">{day(previous.due)}</strong> · </> : null}
                      Q{current.quarter} {current.year} due {day(current.due)}
                    </p>
                  </div>
                  <div className="p-6 md:p-7">
                    <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-3">Q{current.quarter} {current.year} so far</p>
                    <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                      {[
                        ["Start of quarter", figure(quarterly, "Membership", "Membership at start of quarter"), "text-ink"],
                        ["Gains", figure(quarterly, "Membership", "Gains"), "text-ok"],
                        ["Losses", figure(quarterly, "Membership", "Losses"), "text-error"],
                        ["Membership now", figure(quarterly, "Membership", "Membership at end of quarter"), "text-primary"],
                      ].map(([label, value, tone]) => (
                        <div key={label as string}>
                          <dt className="text-[13px] text-ink-2">{label}</dt>
                          <dd className={`mt-1 text-[30px] font-semibold leading-none tabular-nums ${tone}`}>{(value as number).toLocaleString("en-UG")}</dd>
                        </div>
                      ))}
                    </dl>
                    {figure(quarterly, "Membership", "Records added to the register (net)") !== 0 && (
                      <p className="mt-5 rounded-[8px] bg-surface-2 px-3 py-2 text-[13px]">
                        Includes <strong>{figure(quarterly, "Membership", "Records added to the register (net)").toLocaleString("en-UG")}</strong> records added to the register this quarter (for example by import).
                      </p>
                    )}
                    <p className="mt-4 border-t border-line pt-4 text-[13px] text-ink-2">
                      Members on the church books: active, irregular and under discipline, plus records with no status yet. Approved transfers, deaths and other status changes count as gains or losses on their effective date.
                    </p>
                  </div>
                </div>
              </section>
            )}

            {others.length > 0 && (
              <section aria-labelledby="lib-title">
                <h2 id="lib-title" className="mb-3 text-[17px] font-semibold">Report library</h2>
                <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {others.map((k) => {
                    const meta = REPORT_META[k];
                    return (
                      <li key={k}>
                        <Link href={`/reports/${k}`} className="card group flex h-full flex-col p-5 transition-colors hover:border-primary">
                          <span className="flex items-start justify-between gap-3">
                            <span className="grid size-10 place-items-center rounded-[10px] bg-primary-soft text-primary">
                              <ReportIcon reportKey={k} />
                            </span>
                            <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-2">{meta?.category}</span>
                          </span>
                          <span className="mt-4 block text-[16px] font-semibold">{REPORTS[k].title}</span>
                          <span className="mt-1 block text-[13px] text-ink-2">{REPORTS[k].description}</span>
                          {meta && (
                            <ul className="mt-3 space-y-1 text-[13px]">
                              {meta.includes.map((i) => (
                                <li key={i} className="flex gap-2"><span aria-hidden className="text-primary">✓</span>{i}</li>
                              ))}
                            </ul>
                          )}
                          <span className="mt-auto flex items-center justify-between pt-5">
                            <FormatChips />
                            <span className="text-[13px] font-semibold text-primary group-hover:underline">Open →</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
              {canDownload ? (
                <section className="card overflow-hidden">
                  <div className="flex items-baseline justify-between border-b border-line px-5 py-4">
                    <h2 className="text-[17px] font-semibold">Your recent downloads</h2>
                    <span className="text-[12px] text-ink-3">Logged for data protection</span>
                  </div>
                  {recent.length === 0 ? (
                    <p className="px-5 py-6 text-[14px] text-ink-2">Nothing downloaded yet. Open a report and choose Download.</p>
                  ) : (
                    <table className="w-full text-[14px]">
                      <thead className="text-left text-[11px] uppercase tracking-wider text-ink-3">
                        <tr>
                          <th scope="col" className="px-5 py-2.5 font-semibold">Report</th>
                          <th scope="col" className="px-3 py-2.5 font-semibold">Format</th>
                          <th scope="col" className="hidden px-3 py-2.5 text-right font-semibold sm:table-cell">Rows</th>
                          <th scope="col" className="px-5 py-2.5 text-right font-semibold">When</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {recent.map((e) => {
                          const k = e.kind.replace(/^report:/, "");
                          return (
                            <tr key={e.id}>
                              <td className="px-5 py-2.5">{isReportKey(k) ? REPORTS[k].title : k === "members" ? "Member directory export" : k.replace(/-/g, " ")}</td>
                              <td className="px-3 py-2.5"><span className="rounded-[4px] bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold uppercase">{e.format}</span></td>
                              <td className="hidden px-3 py-2.5 text-right tabular-nums text-ink-2 sm:table-cell">{e.rowCount.toLocaleString("en-UG")}</td>
                              <td className="whitespace-nowrap px-5 py-2.5 text-right text-[13px] text-ink-2">{eat(e.createdAt)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </section>
              ) : (
                <section className="card p-5 text-[14px] text-ink-2">You can preview and print reports. Downloading PDF or Excel copies needs export access from the Church Clerk.</section>
              )}
              <aside className="card p-5">
                <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                  <svg aria-hidden viewBox="0 0 24 24" className="size-[18px] text-primary" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" /></svg>
                  Handling reports
                </h2>
                <ul className="mt-3 space-y-2 text-[13px] text-ink-2">
                  <li>Reports contain personal data protected by the Data Protection and Privacy Act, 2019.</li>
                  <li>Use them for church administration only and don’t share them outside the church.</li>
                  <li>Every download is recorded with your name and the time.</li>
                  <li>Columns your role can’t see are left out automatically.</li>
                </ul>
              </aside>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
