import type { Metadata } from "next";
import Link from "next/link";
import type { MeetingType } from "@/generated/prisma/client";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { MinutesStatus } from "@/components/minutes/minutes-status";
import { EmptyState } from "@/components/ui/states";
import { eat, meetingDayShort } from "@/lib/minutes-format";
import { requirePermission } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { db } from "@/server/db";
import { listMinutes, MEETING_TYPES } from "@/server/minutes/service";

export const metadata: Metadata = { title: "Board minutes" };

export default async function MinutesPage({ searchParams }: { searchParams: Promise<{ q?: string; year?: string; type?: string }> }) {
  const ctx = await requirePermission("minutes", "read");
  const sp = await searchParams;
  const type = sp.type && sp.type in MEETING_TYPES ? (sp.type as MeetingType) : undefined;
  const year = sp.year ? Number(sp.year) || undefined : undefined;
  const { rows, years } = await listMinutes(db, ctx, { q: sp.q, year, type });
  const canManage = can(ctx, "minutes", "manage");
  const filtered = Boolean(sp.q || year || type);

  // Group by year of the meeting, newest first.
  const groups = new Map<number, typeof rows>();
  for (const r of rows) {
    const y = r.heldOn.getUTCFullYear();
    groups.set(y, [...(groups.get(y) ?? []), r]);
  }

  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7">
        <PageHeader title="Board minutes" subtitle="Official minutes of church board and business meetings. Every upload, change and download is recorded.">
          {canManage && <Link href="/minutes/new" className="btn btn-primary">Record minutes</Link>}
        </PageHeader>

        <form action="/minutes" role="search" className="card mb-5 flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[220px] flex-1">
            <label htmlFor="mq" className="field-label">Search</label>
            <input id="mq" name="q" type="search" defaultValue={sp.q} className="input" placeholder="Reference, title, decision or venue" />
          </div>
          <div>
            <label htmlFor="my" className="field-label">Year</label>
            <select id="my" name="year" defaultValue={year ?? ""} className="input min-w-[120px]">
              <option value="">All years</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="mt" className="field-label">Meeting</label>
            <select id="mt" name="type" defaultValue={type ?? ""} className="input min-w-[190px]">
              <option value="">All meetings</option>
              {Object.entries(MEETING_TYPES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
            </select>
          </div>
          <button className="btn btn-secondary">Apply</button>
          {filtered && <Link href="/minutes" className="btn btn-secondary">Clear</Link>}
        </form>

        {rows.length === 0 ? (
          <EmptyState
            title={filtered ? "No minutes match" : "No minutes recorded yet"}
            action={!filtered && canManage ? <Link href="/minutes/new" className="btn btn-primary">Record the first minutes</Link> : undefined}
          >
            {filtered ? "Try another search, year or meeting type." : "Upload the minutes of each board meeting to keep a permanent, searchable register."}
          </EmptyState>
        ) : (
          <div className="space-y-6">
            {[...groups.entries()].map(([y, list]) => (
              <section key={y} className="card overflow-hidden">
                <h2 className="flex items-baseline justify-between border-b border-line bg-surface-2 px-5 py-3 text-[15px] font-semibold">
                  {y}
                  <span className="text-[13px] font-normal text-ink-2">{list.length} meeting{list.length === 1 ? "" : "s"}</span>
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-[14px]">
                    <thead className="text-left text-[12px] uppercase tracking-wider text-ink-3">
                      <tr>
                        <th scope="col" className="px-5 py-2.5 font-semibold">Reference</th>
                        <th scope="col" className="px-3 py-2.5 font-semibold">Meeting date</th>
                        <th scope="col" className="px-3 py-2.5 font-semibold">Meeting</th>
                        <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                        <th scope="col" className="px-3 py-2.5 font-semibold">Files</th>
                        <th scope="col" className="px-5 py-2.5 font-semibold">Recorded</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {list.map((r) => (
                        <tr key={r.id} className="hover:bg-surface-2/60">
                          <td className="whitespace-nowrap px-5 py-3">
                            <Link href={`/minutes/${r.id}`} className="mono font-semibold text-primary hover:underline">{r.reference}</Link>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">{meetingDayShort(r.heldOn)}</td>
                          <td className="px-3 py-3">
                            <Link href={`/minutes/${r.id}`} className="font-medium hover:underline">{r.title}</Link>
                            {r.summary && <span className="mt-0.5 line-clamp-1 block max-w-[46ch] text-[13px] text-ink-2">{r.summary}</span>}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3"><MinutesStatus status={r.status} approvedOn={r.approvedOn} /></td>
                          <td className="whitespace-nowrap px-3 py-3 text-ink-2">{r.fileCount ? `${r.fileCount} file${r.fileCount === 1 ? "" : "s"}` : <span className="text-[var(--status-irregular)]">No file yet</span>}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-[13px] text-ink-2">{eat(r.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
