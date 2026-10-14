import type { Metadata } from "next";
import Link from "next/link";
import { AttendanceRow, FigureRow, SendPanel } from "@/components/conference/return-widgets";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { LETTERHEAD } from "@/lib/letterhead";
import { requirePermission } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { getConferenceReturn, previousPeriod, quarterWord } from "@/server/conference/service";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Conference return" };

const DRILL = new Set(["baptism", "profession", "lettersIn", "lettersOut", "death", "apostasy", "missing"]);
const day = (d: Date | string) => new Date(typeof d === "string" ? `${d}T00:00:00Z` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** The quarter normally being reported: the one that has just ended. */
function defaultPeriod() {
  const now = new Date();
  return previousPeriod({ year: now.getUTCFullYear(), quarter: Math.floor(now.getUTCMonth() / 3) + 1 });
}

export default async function ConferenceReturnPage({ searchParams }: { searchParams: Promise<{ year?: string; quarter?: string }> }) {
  const ctx = await requirePermission("conference_return", "read");
  const sp = await searchParams;
  const fallback = defaultPeriod();
  const period = { year: Number(sp.year) || fallback.year, quarter: Math.min(4, Math.max(1, Number(sp.quarter) || fallback.quarter)) };
  const r = await getConferenceReturn(db, ctx, period);
  const canManage = can(ctx, "conference_return", "manage");
  const editable = canManage && r.state === "DRAFT";
  const q = `year=${r.period.year}&quarter=${r.period.quarter}`;
  const thisYear = new Date().getUTCFullYear();
  const lines = r.lines.map((l) => ({ key: l.key, code: l.code, label: l.label, source: l.key === "opening" && r.openingFrom === "previous" ? "Last quarter’s closing figure (as sent)" : l.source, computed: l.computed, value: l.value, override: l.override, drill: DRILL.has(l.key) }));
  const byGroup = (g: string) => lines.filter((l) => r.lines.find((x) => x.key === l.key)!.group === g);
  const val = (k: string) => r.lines.find((l) => l.key === k)!.value;
  const diff = r.closing - r.registerClosing;

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-[1180px] p-4 md:p-7">
        <PageHeader title="Conference statistical return" subtitle={`${LETTERHEAD.conference} · Secretary’s Statistical Report – Quarterly · ${LETTERHEAD.district}`}>
          <a href={`/api/conference/form?${q}`} className="btn btn-primary">Download CUC form (Excel)</a>
          {can(ctx, "report", "read") && <Link href={`/reports/conference?${q}`} className="btn btn-secondary">Letterhead PDF</Link>}
        </PageHeader>

        <form action="/conference" className="card mb-5 flex flex-wrap items-end gap-3 px-5 py-4">
          <div>
            <label htmlFor="c-year" className="field-label">Year</label>
            <select id="c-year" name="year" defaultValue={String(r.period.year)} className="input h-10 min-w-[120px] py-0">
              {Array.from({ length: 6 }, (_, i) => thisYear - i).map((y) => <option key={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="c-q" className="field-label">Quarter</label>
            <select id="c-q" name="quarter" defaultValue={String(r.period.quarter)} className="input h-10 min-w-[170px] py-0">
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>Quarter {quarterWord(n)} ({["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"][n - 1]})</option>)}
            </select>
          </div>
          <button className="btn btn-secondary">Open</button>
          <p className="ml-auto text-[13px] text-ink-2">{day(r.range.start)} – {day(r.range.last)}</p>
        </form>

        {/* Status and balance */}
        <section className="card mb-5 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div className="flex items-center gap-3">
              <span className={`rounded-full px-3 py-1 text-[12px] font-semibold ${r.state === "SENT" ? "bg-[color-mix(in_srgb,var(--ok)_16%,transparent)] text-ok" : "bg-surface-2 text-ink-2"}`}>
                {r.state === "SENT" ? "Sent" : "Draft"}
              </span>
              <h2 className="text-[17px] font-semibold">{r.label}</h2>
            </div>
            <p className="text-[13px] text-ink-2">
              {r.state === "SENT" ? <>Sent {r.dateSent ? day(r.dateSent) : ""}{r.dateReceived ? ` · received ${day(r.dateReceived)}` : " · not yet confirmed received"}</> : "Figures update from the register until you mark the return as sent."}
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4">
            {[
              ["3c · Beginning of quarter", val("opening") ?? 0, ""],
              ["4a–4d · Added", r.added, "+"],
              ["5a–5e · Dropped", r.dropped, "−"],
              ["6 · End of quarter", r.closing, "="],
            ].map(([label, n, sign], i) => (
              <div key={String(label)} className={`border-line px-5 py-4 ${i ? "md:border-l" : ""} ${i === 3 ? "bg-primary-soft/50" : ""} max-md:[&:nth-child(-n+2)]:border-b max-md:[&:nth-child(even)]:border-l`}>
                <p className="text-[12px] text-ink-2">{label}</p>
                <p className={`mt-1 text-[28px] font-semibold tabular-nums ${i === 3 ? "text-primary" : ""}`}>
                  {sign && <span className="mr-1 text-[18px] text-ink-3">{sign}</span>}
                  {Number(n).toLocaleString("en-UG")}
                </p>
              </div>
            ))}
          </div>
          <div className="space-y-2 border-t border-line px-5 py-3 text-[13px]">
            <p className="text-ink-2">
              Register check: the register shows <strong className="text-ink">{r.registerClosing.toLocaleString("en-UG")}</strong> members on the Conference books (Active, Irregular, Under discipline, Dormant) at the end of the quarter
              {diff === 0 ? " — matches the return." : <> — the return is <strong className="text-ink">{Math.abs(diff)} {diff > 0 ? "higher" : "lower"}</strong>. Use adjustments (4d / 5e) with a reason, or update member records, to reconcile.</>}
            </p>
            {r.problems.length > 0 && r.state === "DRAFT" && (
              <ul className="list-disc space-y-0.5 pl-5 text-[var(--status-irregular)]">
                {r.problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
          </div>
        </section>

        {/* CUC row preview */}
        <section className="card mb-5 overflow-hidden" aria-labelledby="row-title">
          <h2 id="row-title" className="border-b border-line px-5 py-3 text-[15px] font-semibold">As it appears on the Conference form</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-center text-[12px]">
              <thead className="bg-surface-2 text-ink-2">
                <tr className="mono text-[11px]">
                  {["1", "2a", "2b", "3a", "3b", "3c", "4a", "4b", "4c", "4d", "5a", "5b", "5c", "5d", "5e", "6", "16a", "16b"].map((c) => <th key={c} className="border border-line px-1.5 py-1 font-semibold">{c}</th>)}
                </tr>
                <tr className="text-[11px] leading-tight">
                  {["District", "Church", "Companies", "Attend. 7th Sabbath", "Attend. 2nd Sabbath", "Membership start", "Baptism", "Prof. of faith", "Letters received", "Adjust.", "Letters granted", "Death", "Apostasies", "Missing", "Adjust.", "Membership end", "Attend. 2nd Sabbath", "Attend. 7th Sabbath"].map((c, i) => (
                    <th key={i} className="border border-line px-1.5 py-1.5 font-medium">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="text-[14px] font-semibold tabular-nums">
                  <td className="border border-line px-2 py-2 text-left">{LETTERHEAD.district.toUpperCase()}</td>
                  <td className="border border-line px-2 py-2 text-left">KANYANYA</td>
                  <td className="border border-line px-2 py-2" />
                  {(["att7", "att2", "opening", "baptism", "profession", "lettersIn", "adjustIn", "lettersOut", "death", "apostasy", "missing", "adjustOut"] as const).map((k) => (
                    <td key={k} className={`border border-line px-2 py-2 ${r.lines.find((l) => l.key === k)!.override ? "bg-[color-mix(in_srgb,var(--status-irregular)_14%,transparent)]" : ""}`}>{val(k) ?? ""}</td>
                  ))}
                  <td className="border border-line bg-primary-soft/60 px-2 py-2 text-primary">{r.closing}</td>
                  <td className="border border-line px-2 py-2" />
                  <td className="border border-line px-2 py-2" />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="px-5 py-2.5 text-[12px] text-ink-3">Shaded figures were entered by the clerk. Columns 16a and 16b are left blank.</p>
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            {[
              ["membership", "Membership", "Line 3c"],
              ["added", "Members added during the quarter", "Lines 4a–4d"],
              ["dropped", "Members dropped during the quarter", "Lines 5a–5e"],
              ["attendance", "Church attendance", "Lines 3a–3b"],
            ].map(([g, title, sub]) => (
              <section key={g} className="card px-5 pt-4">
                <div className="flex items-baseline justify-between gap-2 border-b border-line pb-3">
                  <h2 className="text-[16px] font-semibold">{title}</h2>
                  <span className="text-[12px] text-ink-3">{sub}</span>
                </div>
                <ul className="divide-y divide-line">
                  {byGroup(g).map((l) => <FigureRow key={l.key} period={r.period} line={l} editable={editable} />)}
                </ul>
              </section>
            ))}
          </div>

          <div className="space-y-5">
            <section className="card overflow-hidden">
              <div className="border-b border-line px-5 py-4">
                <h2 className="text-[16px] font-semibold">Sabbath attendance</h2>
                <p className="mt-0.5 text-[13px] text-ink-2">Enter the head count each Sabbath. The 2nd and 7th Sabbaths of the quarter go on the return.</p>
              </div>
              <ul className="divide-y divide-line">
                {r.sabbaths.map((s) => (
                  <AttendanceRow key={s.date} sabbath={s.date} n={s.n} label={day(s.date)} count={s.count} editable={canManage} reported={s.n === 2 || s.n === 7} upcoming={s.upcoming} />
                ))}
              </ul>
            </section>

            {canManage && (
              <section className="card p-5">
                <h2 className="text-[16px] font-semibold">{r.state === "SENT" ? "Sent to the Conference" : "Send to the Conference"}</h2>
                <p className="mb-4 mt-0.5 text-[13px] text-ink-2">
                  {r.state === "SENT" ? `Submitted by Pastor ${r.pastorName ?? "—"}.` : "Download the CUC form, send it to the district, then record it here."}
                </p>
                <SendPanel period={r.period} state={r.state} pastorName={r.pastorName} dateSent={iso(r.dateSent)} dateReceived={iso(r.dateReceived)} canManage={canManage} blocked={r.problems.length > 0} />
              </section>
            )}

            <section className="rounded-[10px] border border-line p-4 text-[13px] text-ink-2">
              <p className="font-semibold text-ink">Where the figures come from</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5">
                <li>Baptisms, professions of faith, transfers and deaths: <Link href="/transfers/new" className="text-primary underline">Change status</Link> on the member.</li>
                <li>Apostasies and Missing: members changed to Left the Faith or Missing in the quarter.</li>
                <li>Membership counts Active, Irregular, Under discipline and Dormant members.</li>
                <li>Any figure can be replaced with your own; the reason is kept and shown on the form.</li>
              </ul>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
