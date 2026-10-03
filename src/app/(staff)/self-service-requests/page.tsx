import type { Metadata } from "next";
import Link from "next/link";
import { ReviewCorrection } from "@/components/selfservice/review-widgets";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { correctionQueue } from "@/server/selfservice/service";

export const metadata: Metadata = { title: "Self-service requests" };

export default async function SelfServiceRequestsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requirePermission("correction_request", "review");
  const { view } = await searchParams;
  const done = view === "done";
  const items = await correctionQueue(db, ctx, done ? "DONE" : "PENDING");
  const tab = (href: string, label: string, active: boolean) => (
    <Link href={href} aria-current={active ? "page" : undefined} className={`inline-flex min-h-[44px] items-center border-b-2 px-3 text-[14px] ${active ? "border-primary font-semibold" : "border-transparent text-ink-2"}`}>{label}</Link>
  );
  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7">
        <PageHeader title="Self-service requests" subtitle="Corrections members asked for after signing in with their phone. Approved changes are saved with the audit source “self-service”." />
        <nav aria-label="Request views" className="mb-5 flex gap-1 border-b border-line">
          {tab("/self-service-requests", "Waiting", !done)}
          {tab("/self-service-requests?view=done", "Recently decided", done)}
        </nav>
        {items.length === 0 ? (
          <EmptyState title={done ? "Nothing decided yet" : "No requests waiting"}>{done ? undefined : "When members ask for corrections, they appear here for review."}</EmptyState>
        ) : (
          <ul className="space-y-4">
            {items.map((r) => (
              <li key={r.id} className="card p-5">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <Link href={`/members/${r.member.id}`} className="text-[17px] font-semibold hover:underline">{r.member.name}</Link>
                    <span className="mono ml-2 text-[13px] text-ink-2">{r.member.memberId}</span>
                  </span>
                  <span className="text-[13px] text-ink-2">Sent {formatDateTime(r.createdAt)}</span>
                </div>
                {r.note && <p className="mb-3 rounded-[6px] bg-surface-2 px-3 py-2 text-[14px]">“{r.note}”</p>}
                {done ? (
                  <>
                    <ul className="text-[14px]">
                      {r.rows.map((x) => (
                        <li key={x.field} className={x.applied ? "" : "text-ink-3 line-through"}>{x.label}: {x.from || "—"} → <strong>{x.to || "—"}</strong></li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[13px] text-ink-2">{r.state === "APPROVED" ? "Approved" : "Rejected"} by {r.reviewer} · {r.reviewedAt ? formatDateTime(r.reviewedAt) : ""}{r.reviewNote ? ` · “${r.reviewNote}”` : ""}</p>
                  </>
                ) : (
                  <ReviewCorrection id={r.id} rows={r.rows} memberName={r.member.name} />
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
