import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { EmptyState } from "@/components/ui/states";
import { requirePermission } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { db } from "@/server/db";
import { availableReports, REPORTS } from "@/server/reports/reports";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const ctx = await requirePermission("report", "read");
  const keys = availableReports(ctx);
  const recent = can(ctx, "export", "run")
    ? await db.exportLog.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: "desc" }, take: 5 })
    : [];
  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7">
        <PageHeader title="Reports" subtitle="Preview on screen, print, or download as PDF or Excel. Downloads are logged." />
        {keys.length === 0 ? (
          <EmptyState title="No reports for your role">Reports need access to member profiles. Ask the Church Clerk if you need one.</EmptyState>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {keys.map((k) => (
              <li key={k}>
                <Link href={`/reports/${k}`} className="card block h-full p-5 hover:border-primary">
                  <span className="block text-[17px] font-semibold">{REPORTS[k].title}</span>
                  <span className="mt-1.5 block text-[14px] text-ink-2">{REPORTS[k].description}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {recent.length > 0 && (
          <section className="card mt-6 p-5">
            <h2 className="mb-3 text-[17px] font-semibold">Your recent downloads</h2>
            <ul className="divide-y divide-line text-[14px]">
              {recent.map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>{e.kind.replace(/^report:/, "").replace(/-/g, " ")} · {e.format.toUpperCase()} · {e.rowCount} rows</span>
                  <span className="text-ink-2">{e.createdAt.toLocaleString("en-GB", { timeZone: "Africa/Kampala", dateStyle: "medium", timeStyle: "short" })}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
