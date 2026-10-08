import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DownloadReport, PrintButton } from "@/components/reports/report-actions";
import { TopBar } from "@/components/shell/topbar";
import { EmptyState } from "@/components/ui/states";
import { REPORT_META, ReportIcon } from "@/components/reports/report-meta";
import { STATUS_KEYS, STATUS_META } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { listMinistries } from "@/server/ministries/service";
import { AGE_GROUPS, buildReport, isReportKey, MOVEMENT_TYPE_LABELS, parseReportParams, REPORTS, type Report, type ReportKey } from "@/server/reports/reports";

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
    if (e instanceof ForbiddenError) {
      const missing = (REPORTS[key].needs ?? []).find(([r, a]) => !can(ctx, r, a));
      redirect(`/denied?need=${encodeURIComponent(missing ? `${missing[0]}:${missing[1]}` : "member.profile:read")}`);
    }
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const search = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();

  const meta = REPORT_META[key];
  const canDownload = can(ctx, "export", "run");
  const generated = report.generatedAt.toLocaleString("en-GB", { timeZone: "Africa/Kampala", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const tables = report.sections.filter((s) => s.table);
  const firstSummary = report.sections.find((s) => s.summary);

  return (
    <>
      <div className="print:hidden"><TopBar /></div>
      <main className="p-4 md:p-7 print:p-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <nav aria-label="Breadcrumb" className="text-[14px] text-ink-2">
            <Link href="/reports" className="hover:text-ink hover:underline">Reports</Link>
            <span className="mx-1.5 text-ink-3">/</span>
            <span className="text-ink">{REPORTS[key].title}</span>
          </nav>
          <div className="flex gap-2">
            <PrintButton />
            {canDownload && <DownloadReport reportKey={key} search={search ? `?${search}` : ""} title={report.title.toLowerCase()} />}
          </div>
        </div>

        <header className="card mb-5 overflow-hidden print:border-0 print:shadow-none">
          <div className="flex flex-wrap items-start justify-between gap-5 p-5 md:p-7">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-[12px] bg-primary-soft text-primary print:hidden">
                <ReportIcon reportKey={key} className="size-6" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                  Seventh-day Adventist Church Kanyanya{meta && <> · {meta.category}</>}
                </p>
                <h1 className="mt-1 text-[24px] font-semibold leading-tight md:text-[28px]">{report.title}</h1>
                <p className="mt-1 text-[15px] text-ink-2">{report.subtitle}</p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
              <dt className="text-ink-3">Generated</dt><dd className="text-right">{generated} EAT</dd>
              <dt className="text-ink-3">By</dt><dd className="text-right">{report.generatedBy}</dd>
              <dt className="text-ink-3">Records</dt><dd className="text-right font-semibold tabular-nums">{report.rowCount.toLocaleString("en-UG")}</dd>
            </dl>
          </div>
          <ParamsForm reportKey={key} p={p as Record<string, unknown>} ctx={ctx} />
        </header>

        {report.sections.length === 0 ? (
          <EmptyState title="Choose what to report on">Pick the options above, then select Update report.</EmptyState>
        ) : (
          <div className="space-y-5">
            {firstSummary && firstSummary.summary!.length <= 6 && <Tiles section={firstSummary} />}
            {report.sections.filter((s) => s.summary && !(s === firstSummary && s.summary.length <= 6)).length > 0 && (
              <div className="grid gap-5 lg:grid-cols-2 print:block print:space-y-4">
                {report.sections
                  .filter((s) => s.summary && !(s === firstSummary && s.summary.length <= 6))
                  .map((s) => <SummaryCard key={s.heading} section={s} />)}
              </div>
            )}
            {tables.map((s) => <TableCard key={s.heading} section={s} />)}
          </div>
        )}

        <p className="mt-6 flex items-start gap-2 rounded-[10px] border border-line bg-surface px-4 py-3 text-[12px] text-ink-2">
          <svg aria-hidden viewBox="0 0 24 24" className="mt-px size-4 shrink-0 text-primary" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" /></svg>
          <span>
            Contains personal data protected by the Data Protection and Privacy Act, 2019 — for church administration only.
            {report.omitted.length > 0 && <> Columns not shown for your role: {report.omitted.join(", ")}.</>}
          </span>
        </p>
      </main>
    </>
  );
}

type Section = Report["sections"][number];
/** Leading number of a value such as 342 or "342 (32%)". */
const num = (v: string | number) => (typeof v === "number" ? v : Number(String(v).match(/^-?[\d,]+/)?.[0]?.replace(/,/g, "") ?? 0));
const show = (v: string | number) => (typeof v === "number" ? v.toLocaleString("en-UG") : v);

function Tiles({ section }: { section: Section }) {
  return (
    <section aria-label={section.heading} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 print:grid-cols-3">
      {section.summary!.map((it) => (
        <div key={it.label} className={`card p-4 ${/^total|at end of/i.test(it.label) ? "border-primary/40 bg-primary-soft/40" : ""}`}>
          <p className="text-[12px] font-medium text-ink-2">{it.label}</p>
          <p className="mt-1.5 text-[26px] font-semibold leading-none tabular-nums">{show(it.value)}</p>
        </div>
      ))}
      {section.note && <p className="col-span-full text-[12px] text-ink-3">{section.note}</p>}
    </section>
  );
}

function SummaryCard({ section }: { section: Section }) {
  const items = section.summary!;
  const max = Math.max(1, ...items.map((i) => num(i.value)));
  return (
    <section className="card break-inside-avoid p-5">
      <h2 className="text-[16px] font-semibold">{section.heading}</h2>
      {section.note && <p className="mt-1 text-[12px] text-ink-3">{section.note}</p>}
      <ul className="mt-3 space-y-2.5">
        {items.map((it) => (
          <li key={it.label}>
            <div className="flex items-baseline justify-between gap-3 text-[14px]">
              <span>{it.label}</span>
              <span className="font-semibold tabular-nums">{show(it.value)}</span>
            </div>
            {items.length > 1 && (
              <div aria-hidden className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.round((num(it.value) / max) * 100)}%` }} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function TableCard({ section }: { section: Section }) {
  const t = section.table!;
  return (
    <section className="card overflow-hidden print:break-inside-auto print:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3.5">
        <h2 className="text-[16px] font-semibold">{section.heading}</h2>
        <span className="text-[12px] text-ink-3">{t.rows.length.toLocaleString("en-UG")} row{t.rows.length === 1 ? "" : "s"}</span>
      </div>
      {section.note && <p className="px-5 pt-3 text-[12px] text-ink-3">{section.note}</p>}
      {t.rows.length === 0 ? (
        <p className="px-5 py-6 text-[14px] text-ink-2">Nothing to list.</p>
      ) : (
        <div className="max-h-[70vh] overflow-auto print:max-h-none print:overflow-visible">
          <table className="w-full text-[14px] print:text-[10px]">
            <thead className="sticky top-0 z-10 bg-surface-2 text-left text-[11px] uppercase tracking-wider text-ink-2">
              <tr>
                <th scope="col" className="w-10 px-3 py-2.5 text-right font-semibold">#</th>
                {t.columns.map((c) => <th key={c.key} scope="col" className="px-3 py-2.5 font-semibold">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r, i) => (
                <tr key={i} className="border-t border-line align-top even:bg-surface-2/40">
                  <td className="px-3 py-2 text-right text-[12px] tabular-nums text-ink-3">{i + 1}</td>
                  {t.columns.map((c) => (
                    <td key={c.key} className={`px-3 py-2 ${c.key === "memberId" || c.key === "reference" ? "mono whitespace-nowrap text-[13px]" : ""}`}>{String(r[c.key] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function ParamsForm({ reportKey, p, ctx }: { reportKey: ReportKey; p: Record<string, unknown>; ctx: Awaited<ReturnType<typeof requirePermission>> }) {
  const sel = "input h-10 min-w-[150px] py-0";
  const needsZones = ["status", "zones", "overview", "age-groups", "data-quality"].includes(reportKey);
  const zones = needsZones ? await db.listItem.findMany({ where: { type: "ZONE", active: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }) : [];
  const ministries = reportKey === "ministry-roster" ? await listMinistries(db, ctx) : [];
  const year = new Date().getUTCFullYear();
  const field = (id: string, label: string, control: React.ReactNode) => (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      {control}
    </div>
  );
  const years = (name: string, id: string) => (
    <select id={id} name={name} defaultValue={String(p[name])} className={sel}>
      {Array.from({ length: 8 }, (_, i) => year - i).map((y) => <option key={y}>{y}</option>)}
    </select>
  );
  const controls: React.ReactNode[] = [];
  if (reportKey === "quarterly") {
    controls.push(field("r-year", "Year", years("year", "r-year")));
    controls.push(field("r-q", "Quarter", (
      <select id="r-q" name="quarter" defaultValue={String(p.quarter)} className={sel}>
        {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q} ({["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"][q - 1]})</option>)}
      </select>
    )));
  }
  if (reportKey === "minutes") controls.push(field("r-year", "Year", years("year", "r-year")));
  if (reportKey === "movements") {
    controls.push(field("r-from", "From", <input id="r-from" type="date" name="from" defaultValue={String(p.from)} className={sel} />));
    controls.push(field("r-to", "To", <input id="r-to" type="date" name="to" defaultValue={String(p.to)} className={sel} />));
    controls.push(field("r-type", "Type of change", (
      <select id="r-type" name="type" defaultValue={String(p.type ?? "")} className={sel}>
        <option value="">All changes</option>
        {Object.entries(MOVEMENT_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    )));
  }
  if (reportKey === "status") {
    controls.push(field("r-status", "Status", (
      <select id="r-status" name="status" defaultValue={String(p.status ?? "")} className={sel}>
        <option value="">All statuses</option>
        {STATUS_KEYS.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        <option value="NONE">Not recorded</option>
      </select>
    )));
  }
  if (reportKey === "age-groups") {
    controls.push(field("r-group", "Age group", (
      <select id="r-group" name="group" defaultValue={String(p.group ?? "")} className={sel}>
        <option value="">All age groups</option>
        {AGE_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
      </select>
    )));
  }
  if (reportKey === "data-quality") {
    controls.push(field("r-below", "Show records", (
      <select id="r-below" name="below" defaultValue={String(p.below ?? 100)} className={sel}>
        <option value="100">All incomplete</option>
        <option value="80">Below 80% complete</option>
        <option value="50">Below 50% complete</option>
        <option value="16">Name and ID only</option>
      </select>
    )));
  }
  if (needsZones) {
    controls.push(field("r-zone", "Zone", (
      <select id="r-zone" name="zone" defaultValue={String(p.zone ?? "")} className={sel}>
        <option value="">All zones</option>
        {zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
        <option value="NONE">Not recorded</option>
      </select>
    )));
  }
  if (reportKey === "ministry-roster") {
    controls.push(field("r-ministry", "Ministry", (
      <select id="r-ministry" name="ministry" defaultValue={String(p.ministry ?? "")} className={sel} required>
        <option value="">Choose…</option>
        {ministries.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
    )));
  }
  if (reportKey === "birthdays") {
    controls.push(field("r-month", "Month", (
      <select id="r-month" name="month" defaultValue={String(p.month)} className={sel}>
        {Array.from({ length: 12 }, (_, i) => (
          <option key={i} value={i + 1}>{new Date(Date.UTC(2000, i, 1)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" })}</option>
        ))}
      </select>
    )));
  }
  if (controls.length === 0) return null;
  return (
    <form className="flex flex-wrap items-end gap-3 border-t border-line bg-surface-2/50 px-5 py-4 md:px-7 print:hidden" action={`/reports/${reportKey}`}>
      <p className="w-full text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">Report options</p>
      {controls.map((c, i) => <div key={i}>{c}</div>)}
      <button className="btn btn-primary">Update report</button>
    </form>
  );
}
