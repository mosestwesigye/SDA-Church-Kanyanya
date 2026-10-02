import type { Metadata } from "next";
import Link from "next/link";
import { DecisionButtons, TransferStageButtons } from "@/components/workflows/workflow-forms";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { StatusBadge } from "@/components/ui/badges";
import type { Prisma } from "@/generated/prisma/client";
import { formatDate, STATUS_META, type StatusKey } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { can, memberScopeWhere } from "@/server/authz/policy";
import { db } from "@/server/db";
import { REQUEST_TYPES } from "@/server/workflows/status";

export const metadata: Metadata = { title: "Transfers & status" };

const STAGES = ["REQUESTED", "LETTER", "BOARD_APPROVED", "COMPLETED"] as const;

export default async function TransfersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePermission("transfer", "read");
  const { tab: t } = await searchParams;
  const tab = t === "transfers" || t === "history" ? t : "inbox";
  const scope = memberScopeWhere(ctx) as Prisma.MemberWhereInput;
  const include = {
    member: { select: { id: true, memberId: true, lastName: true, firstName: true, status: true } },
    document: { select: { id: true, fileName: true } },
    transfer: true,
  } satisfies Prisma.StatusChangeRequestInclude;

  const [pending, transfers, history] = await Promise.all([
    db.statusChangeRequest.findMany({ where: { state: "PENDING", member: scope }, include, orderBy: { requestedAt: "asc" } }),
    db.transfer.findMany({
      where: { member: scope, stage: { notIn: ["CANCELLED"] } },
      include: { member: { select: { id: true, memberId: true, lastName: true, firstName: true } }, statusRequest: { select: { state: true } } },
      orderBy: { requestedAt: "desc" },
      take: 100,
    }),
    db.statusChangeRequest.findMany({ where: { state: { not: "PENDING" }, member: scope }, include, orderBy: { decidedAt: "desc" }, take: 100 }),
  ]);
  const users = new Map(
    (await db.user.findMany({ where: { id: { in: [...pending, ...history].flatMap((r) => [r.requestedById, r.decidedById]).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );
  const canApprove = can(ctx, "status_request", "approve");
  const canUpdateTransfer = can(ctx, "transfer", "update");
  const openTransfers = transfers.filter((x) => x.stage !== "COMPLETED");

  const tabs = [
    { key: "inbox", label: canApprove ? "Approval inbox" : "Pending requests", count: pending.length },
    { key: "transfers", label: "Transfers", count: openTransfers.length },
    { key: "history", label: "Decided" },
  ];

  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7">
        <PageHeader title="Transfers & status changes" subtitle="Status changes go through approval. Approved changes update the member’s status and history.">
          {can(ctx, "status_request", "create") && <Link href="/transfers/new" className="btn btn-primary">New request</Link>}
        </PageHeader>
        <nav aria-label="Sections" className="-mx-4 mb-5 flex overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
          {tabs.map((x) => (
            <Link key={x.key} href={`/transfers${x.key === "inbox" ? "" : `?tab=${x.key}`}`} aria-current={tab === x.key ? "page" : undefined}
              className={`flex min-h-[44px] items-center gap-2 whitespace-nowrap px-4 text-[14px] ${tab === x.key ? "border-b-2 border-primary font-semibold" : "text-ink-2"}`}>
              {x.label}
              {x.count !== undefined && <span className={`rounded-full px-2 text-[12px] ${tab === x.key ? "bg-primary text-primary-ink" : "bg-surface-2"}`}>{x.count}</span>}
            </Link>
          ))}
        </nav>

        {tab === "inbox" &&
          (pending.length === 0 ? (
            <Empty title="Nothing waiting for approval">New transfer, death, discipline and restoration requests appear here.</Empty>
          ) : (
            <ul className="space-y-3">
              {pending.map((r) => (
                <li key={r.id} className="card grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_320px]">
                  <div>
                    <p className="text-[13px] font-semibold uppercase tracking-wider text-ink-2">{REQUEST_TYPES[r.type].label}</p>
                    <Link href={`/members/${r.member.id}`} className="text-[18px] font-semibold hover:underline">{r.member.lastName}, {r.member.firstName}</Link>
                    <span className="mono ml-2 text-[13px] text-ink-3">{r.member.memberId}</span>
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-[14px]">
                      <StatusBadge status={r.fromStatus as StatusKey | null} /> <span aria-hidden>→</span> <span className="sr-only">to</span> <StatusBadge status={r.toStatus as StatusKey} />
                      {r.transfer && <span className="text-ink-2">· {r.transfer.direction === "OUT" ? "to" : "from"} {r.transfer.otherChurch}</span>}
                    </p>
                    <p className="mt-2 text-[15px]">{r.reason}</p>
                    <p className="mt-2 text-[13px] text-ink-2">
                      Effective {formatDate(r.effectiveDate)} · requested by {users.get(r.requestedById) ?? "—"} on {formatDate(r.requestedAt)}
                      {r.document && (
                        <> · <a className="text-primary underline" href={`/api/files/${r.document.id}`} target="_blank" rel="noreferrer">{r.document.fileName}</a></>
                      )}
                    </p>
                  </div>
                  <DecisionButtons requestId={r.id} canApprove={canApprove} ownRequest={r.requestedById === ctx.userId} canCancel={r.requestedById === ctx.userId || canApprove} />
                </li>
              ))}
            </ul>
          ))}

        {tab === "transfers" &&
          (transfers.length === 0 ? (
            <Empty title="No transfers yet">Create a transfer in or out with “New request”.</Empty>
          ) : (
            <ul className="space-y-3">
              {transfers.map((x) => {
                const letterDone = Boolean(x.letterSentAt || x.letterReceivedAt);
                const reached = (s: (typeof STAGES)[number]) =>
                  s === "REQUESTED" ? true : s === "LETTER" ? letterDone : s === "BOARD_APPROVED" ? Boolean(x.boardApprovedAt) : x.stage === "COMPLETED";
                return (
                  <li key={x.id} className="card p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span>
                        <span className="text-[13px] font-semibold uppercase tracking-wider text-ink-2">Transfer {x.direction === "OUT" ? "out to" : "in from"} {x.otherChurch}</span>
                        <Link href={`/members/${x.member.id}`} className="block text-[17px] font-semibold hover:underline">{x.member.lastName}, {x.member.firstName} <span className="mono text-[13px] font-normal text-ink-3">{x.member.memberId}</span></Link>
                      </span>
                      <span className="text-[13px] text-ink-2">Requested {formatDate(x.requestedAt)}{x.statusRequest?.state === "REJECTED" ? " · request rejected" : ""}</span>
                    </div>
                    <ol className="mt-4 grid grid-cols-4 gap-2 text-[13px]" aria-label="Transfer stages">
                      {STAGES.map((s) => (
                        <li key={s} className={`rounded-[6px] border px-2 py-2 text-center ${reached(s) ? "border-primary bg-primary-soft font-semibold text-primary" : "border-line text-ink-3"}`}>
                          {reached(s) ? "✓ " : ""}
                          {s === "REQUESTED" ? "Requested" : s === "LETTER" ? (x.direction === "OUT" ? "Letter sent" : "Letter received") : s === "BOARD_APPROVED" ? "Board approved" : "Completed"}
                        </li>
                      ))}
                    </ol>
                    <div className="mt-3">
                      <TransferStageButtons transferId={x.id} direction={x.direction} stage={x.stage} letterDone={letterDone} canUpdate={canUpdateTransfer} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ))}

        {tab === "history" &&
          (history.length === 0 ? (
            <Empty title="No decisions yet">Approved, rejected and cancelled requests appear here.</Empty>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wider text-ink-2">
                  <tr><th className="px-4 py-2.5">Member</th><th className="px-4 py-2.5">Request</th><th className="px-4 py-2.5">Outcome</th><th className="px-4 py-2.5">Decided by</th><th className="px-4 py-2.5">When</th></tr>
                </thead>
                <tbody>
                  {history.map((r) => (
                    <tr key={r.id} className="border-t border-line align-top">
                      <td className="px-4 py-2.5"><Link className="text-primary hover:underline" href={`/members/${r.member.id}`}>{r.member.lastName}, {r.member.firstName}</Link></td>
                      <td className="px-4 py-2.5">{REQUEST_TYPES[r.type].label} → {STATUS_META[r.toStatus as StatusKey].label}</td>
                      <td className="px-4 py-2.5">{r.state.charAt(0) + r.state.slice(1).toLowerCase()}{r.decisionNote ? ` — ${r.decisionNote}` : ""}</td>
                      <td className="px-4 py-2.5">{r.decidedById ? users.get(r.decidedById) : "—"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{r.decidedAt ? formatDate(r.decidedAt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </main>
    </>
  );
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-10 text-center">
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <p className="mt-2 text-ink-2">{children}</p>
    </div>
  );
}
