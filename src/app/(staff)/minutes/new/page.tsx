import type { Metadata } from "next";
import Link from "next/link";
import { MinutesForm } from "@/components/minutes/minutes-widgets";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { requirePermission } from "@/server/auth/session";

export const metadata: Metadata = { title: "Record minutes" };

export default async function NewMinutesPage() {
  await requirePermission("minutes", "manage");
  return (
    <>
      <TopBar />
      <main className="max-w-3xl p-4 md:p-7">
        <Link href="/minutes" className="mb-3 inline-flex min-h-[44px] items-center text-[14px] text-ink-2 hover:text-ink">← Board minutes</Link>
        <PageHeader title="Record minutes" subtitle="A reference number such as CB/2026/01 is assigned when you save." />
        <MinutesForm />
      </main>
    </>
  );
}
