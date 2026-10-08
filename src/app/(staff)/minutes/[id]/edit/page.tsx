import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MinutesForm } from "@/components/minutes/minutes-widgets";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/errors";
import { getMinutes } from "@/server/minutes/service";

export const metadata: Metadata = { title: "Edit minutes" };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function EditMinutesPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("minutes", "manage");
  const { id } = await params;
  const m = await getMinutes(db, ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  return (
    <>
      <TopBar />
      <main className="max-w-3xl p-4 md:p-7">
        <Link href={`/minutes/${m.id}`} className="mb-3 inline-flex min-h-[44px] items-center text-[14px] text-ink-2 hover:text-ink">← {m.reference}</Link>
        <PageHeader title={`Edit ${m.reference}`} subtitle="Changes are recorded in the history with your name and the time." />
        <MinutesForm
          id={m.id}
          initial={{
            type: m.type, title: m.title, heldOn: day(m.heldOn), startTime: m.startTime ?? "", venue: m.venue ?? "", chairperson: m.chairperson ?? "",
            secretary: m.secretary ?? "", attendance: m.attendance == null ? "" : String(m.attendance), summary: m.summary ?? "", status: m.status, approvedOn: day(m.approvedOn),
          }}
        />
      </main>
    </>
  );
}
