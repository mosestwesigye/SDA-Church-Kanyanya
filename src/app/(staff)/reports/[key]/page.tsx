import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DownloadReport, PrintButton } from "@/components/reports/report-actions";
import { TopBar } from "@/components/shell/topbar";
import { EmptyState } from "@/components/ui/states";
import { ReportIcon } from "@/components/reports/report-meta";
import { LETTERHEAD } from "@/lib/letterhead";
import { STATUS_META } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { listMinistries } from "@/server/ministries/service";
import { AGE_GROUPS, buildReport, documentSections, isReportKey, MOVEMENT_TYPE_LABELS, parseReportParams, REPORTS, type Report, type ReportKey } from "@/server/reports/reports";

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

  const canDownload = can(ctx, "export", "run");
  const eat = (o: Intl.DateTimeFormatOptions) => report.generatedAt.toLocaleString("en-GB", { timeZone: "Africa/Kampala", ...o });
  const generatedDate = eat({ day: "numeric", month: "long", year: "numeric" });
  const generatedTime = eat({ hour: "2-digit", minute: "2-digit", hour12: false });

  const { tiles, summaries, tables, number: no } = documentSections(report);

  return (
    <>
      <div className="print:hidden"><TopBar /></div>
      <main className="p-4 md:p-7 print:p-0">
        <div className="mx-auto max-w-[1180px]">
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

          <ParamsForm reportKey={key} p={p as Record<string, unknown>} ctx={ctx} />

          <article className="card overflow-hidden print:rounded-none print:border-0 print:shadow-none">
            {/* Letterhead */}
            <div aria-hidden className="h-1.5 bg-primary print:h-1" />
            <header className="flex flex-wrap items-start justify-between gap-5 px-6 pb-5 pt-6 md:px-10 md:pt-8">
              <div className="flex items-center gap-4">
                <span className="grid size-14 shrink-0 place-items-center rounded-[12px] bg-sidebar print:[-webkit-print-color-adjust:exact] print:[print-color-adjust:exact]">
                  <Image src="/sda-mark.png" alt="" width={30} height={33} />
                </span>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{LETTERHEAD.church}</p>
                  <p className="text-[19px] font-semibold leading-tight">{LETTERHEAD.local}</p>
                  <p className="text-[13px] text-ink-2">{LETTERHEAD.conference} · {LETTERHEAD.office}</p>
                </div>
              </div>
              <dl className="text-[13px] sm:text-right">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">Reference</dt>
                <dd className="mono text-[14px] font-semibold text-primary">{report.reference}</dd>
                <dt className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">Date</dt>
                <dd>{generatedDate}</dd>
              </dl>
            </header>
            <div aria-hidden className="mx-6 border-t-2 border-ink/80 md:mx-10" />
            <div aria-hidden className="mx-6 mt-[3px] border-t border-ink/30 md:mx-10" />

            {/* Title */}
            <div className="flex items-start gap-4 px-6 pb-5 pt-6 md:px-10">
              <span className="mt-1 grid size-11 shrink-0 place-items-center rounded-[10px] bg-primary-soft text-primary print:hidden">
                <ReportIcon reportKey={key} className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{report.category} report</p>
                <h1 className="mt-0.5 text-[26px] font-semibold leading-tight md:text-[30px]">{report.title}</h1>
                <p className="mt-1 text-[15px] text-ink-2">{report.subtitle}</p>
              </div>
            </div>

            {/* Document details */}
            <dl className="mx-6 grid grid-cols-2 overflow-hidden rounded-[10px] border border-line bg-surface-2/60 md:mx-10 md:grid-cols-4">
              <Detail label="Prepared by">{report.generatedBy}{report.generatedRole && <span className="block text-[12px] text-ink-2">{report.generatedRole}</span>}</Detail>
              <Detail label="Generated">{generatedDate}<span className="block text-[12px] text-ink-2">{generatedTime} EAT</span></Detail>
              <Detail label="Records">{report.rowCount.toLocaleString("en-UG")}</Detail>
              <Detail label="Classification">Confidential<span className="block text-[12px] text-ink-2">Church administration only</span></Detail>
            </dl>

            {/* Body */}
            <div className="px-6 py-7 md:px-10">
              {report.sections.length === 0 ? (
                <EmptyState title="Choose what to report on">Pick the options above, then select Update report.</EmptyState>
              ) : (
                <div className="space-y-8">
                  {tiles && <Tiles section={tiles} n={no(tiles)} />}
                  {summaries.length > 0 && (
                    <div className="grid gap-x-8 gap-y-8 lg:grid-cols-2 print:block print:space-y-6">
                      {summaries.map((s) => <SummaryCard key={s.heading} section={s} n={no(s)} />)}
                    </div>
                  )}
                  {tables.map((s) => <TableCard key={s.heading} section={s} n={no(s)} />)}
                </div>
              )}

              {report.signOff && report.sections.length > 0 && <SignOff report={report} />}
            </div>

            {/* Footer */}
            <footer className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-t border-line bg-surface-2/60 px-6 py-4 text-[12px] text-ink-2 md:px-10">
              <p className="flex max-w-2xl items-start gap-2">
                <svg aria-hidden viewBox="0 0 24 24" className="mt-px size-4 shrink-0 text-primary" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" /></svg>
                <span>
                  Contains personal data protected by the Data Protection and Privacy Act, 2019 — for church administration only.
                  {report.omitted.length > 0 && <> Columns not shown for your role: {report.omitted.join(", ")}.</>}
                </span>
              </p>
              <p className="mono whitespace-nowrap text-ink-3">{report.reference} · End of report</p>
            </footer>
          </article>
        </div>
      </main>
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-line px-4 py-3 [&:not(:last-child)]:border-r max-md:[&:nth-child(2)]:border-r-0 max-md:[&:nth-child(-n+2)]:border-b">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-[14px] font-medium">{children}</dd>
    </div>
  );
}

function SectionHeading({ n, section, aside }: { n: number; section: Section; aside?: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
        <h2 className="flex items-baseline gap-2.5 text-[16px] font-semibold">
          <span className="mono text-[13px] font-semibold text-primary">{String(n).padStart(2, "0")}</span>
          {section.heading}
        </h2>
        {aside}
      </div>
      {section.note && <p className="mt-2 text-[12px] leading-relaxed text-ink-3">{section.note}</p>}
    </div>
  );
}

function SignOff({ report }: { report: Report }) {
  const line = (role: string, name?: string) => (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">{role}</p>
      <div className="mt-8 border-b border-ink/40" />
      <div className="mt-1.5 flex justify-between gap-4 text-[12px] text-ink-2">
        <span>{name ?? "Name"}</span>
        <span>Signature &amp; date</span>
      </div>
    </div>
  );
  return (
    <section aria-label="Sign-off" className="mt-10 break-inside-avoid rounded-[10px] border border-line p-5">
      <p className="text-[13px] font-semibold">Certification</p>
      <p className="mt-0.5 text-[12px] text-ink-2">I certify that this report is a true record of the church register on the date shown.</p>
      <div className="mt-2 grid gap-6 sm:grid-cols-2">
        {line(`Prepared by${report.generatedRole ? ` · ${report.generatedRole}` : ""}`, report.generatedBy)}
        {line("Verified by · Pastor / Board chair")}
      </div>
    </section>
  );
}

type Section = Report["sections"][number];
/** Leading number of a value such as 342 or "342 (32%)". */
const num = (v: string | number) => (typeof v === "number" ? v : Number(String(v).match(/^-?[\d,]+/)?.[0]?.replace(/,/g, "") ?? 0));
const show = (v: string | number) => (typeof v === "number" ? v.toLocaleString("en-UG") : v);

const XL_COLS: Record<number, string> = { 2: "print:grid-cols-2", 3: "print:grid-cols-3", 4: "xl:grid-cols-4 print:grid-cols-4", 5: "xl:grid-cols-5 print:grid-cols-5", 6: "xl:grid-cols-6 print:grid-cols-6" };

function Tiles({ section, n }: { section: Section; n: number }) {
  const items = section.summary!;
  return (
    <section className="break-inside-avoid">
      <SectionHeading n={n} section={{ ...section, note: undefined }} />
      <div className={`grid grid-cols-2 overflow-hidden rounded-[10px] border border-line md:grid-cols-3 ${XL_COLS[items.length] ?? ""}`}>
        {items.map((it) => {
          const key = /^total|at end of/i.test(it.label);
          return (
            <div key={it.label} className={`-mb-px -mr-px flex flex-col justify-between gap-2 border-b border-r border-line px-4 py-4 ${key ? "bg-primary-soft/60" : ""}`}>
              <p className="text-[12px] font-medium leading-snug text-ink-2">{it.label}</p>
              <p className={`text-[28px] font-semibold leading-none tabular-nums ${key ? "text-primary" : ""}`}>{show(it.value)}</p>
            </div>
          );
        })}
      </div>
      {section.note && <p className="mt-2 text-[12px] leading-relaxed text-ink-3">{section.note}</p>}
    </section>
  );
}

function SummaryCard({ section, n }: { section: Section; n: number }) {
  const items = section.summary!;
  const max = Math.max(1, ...items.map((i) => num(i.value)));
  return (
    <section className="break-inside-avoid">
      <SectionHeading n={n} section={section} />
      <ul className="space-y-2.5">
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

function TableCard({ section, n }: { section: Section; n: number }) {
  const t = section.table!;
  return (
    <section className="print:break-inside-auto">
      <SectionHeading n={n} section={section} aside={<span className="text-[12px] text-ink-3">{t.rows.length.toLocaleString("en-UG")} row{t.rows.length === 1 ? "" : "s"}</span>} />
      {t.rows.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-line px-5 py-6 text-[14px] text-ink-2">Nothing to list.</p>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-[10px] border border-line print:max-h-none print:overflow-visible">
          <table className="w-full text-[14px] print:text-[10px]">
            <thead className="sticky top-0 z-10 bg-primary text-left text-[11px] uppercase tracking-wider text-primary-ink print:[print-color-adjust:exact]">
              <tr>
                <th scope="col" className="w-10 px-3 py-2.5 text-right font-semibold">No.</th>
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
  if (reportKey === "quarterly" || reportKey === "conference") {
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
        <option value="">Active and irregular</option>
        {(["ACTIVE", "IRREGULAR"] as const).map((s) => <option key={s} value={s}>{STATUS_META[s].label} only</option>)}
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
    <form className="card mb-5 flex flex-wrap items-end gap-3 px-5 py-4 md:px-6 print:hidden" action={`/reports/${reportKey}`}>
      <p className="w-full text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">Report options</p>
      {controls.map((c, i) => <div key={i}>{c}</div>)}
      <button className="btn btn-primary">Update report</button>
    </form>
  );
}
