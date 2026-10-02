import type { Metadata } from "next";
import Link from "next/link";
import { NewRequestForm } from "@/components/workflows/workflow-forms";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import type { Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/server/auth/session";
import { memberScopeWhere } from "@/server/authz/policy";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Change status" };

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ member?: string }> }) {
  const ctx = await requirePermission("status_request", "create");
  const { member } = await searchParams;
  const m = member
    ? await db.member.findFirst({
        where: { AND: [memberScopeWhere(ctx) as Prisma.MemberWhereInput, { id: member, purgedAt: null }] },
        select: { id: true, memberId: true, lastName: true, firstName: true, status: true },
      })
    : null;
  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7 max-w-3xl">
        <nav aria-label="Breadcrumb" className="mb-3 text-[14px] text-ink-2">
          <Link href="/transfers" className="hover:underline">Transfers & status</Link> / New request
        </nav>
        <PageHeader title="Change membership status" subtitle="Status changes need approval from the Pastor or church board. The member’s history records who approved it." />
        <section className="card p-5">
          <NewRequestForm member={m ? { id: m.id, label: `${m.lastName}, ${m.firstName} · ${m.memberId}`, status: m.status } : null} />
        </section>
      </main>
    </>
  );
}
