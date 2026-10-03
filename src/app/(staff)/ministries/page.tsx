import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listMinistries } from "@/server/ministries/service";

export const metadata: Metadata = { title: "Ministries" };

export default async function MinistriesPage() {
  const ctx = await requirePermission("ministry", "read");
  const ministries = await listMinistries(db, ctx);
  const total = ministries.reduce((n, m) => n + m.members, 0);
  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7">
        <PageHeader title="Ministries" subtitle={`${ministries.length} departments · ${total.toLocaleString("en-UG")} ministry memberships`} />
        {ministries.length === 0 ? (
          <div className="card p-10 text-center text-ink-2">No ministries to show for your role.</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wider text-ink-2">
                <tr>
                  <th className="px-4 py-3">Ministry</th>
                  <th className="px-4 py-3">Head</th>
                  <th className="px-4 py-3">Assistant</th>
                  <th className="px-4 py-3 text-right">Members</th>
                </tr>
              </thead>
              <tbody>
                {ministries.map((m) => (
                  <tr key={m.id} className="border-t border-line">
                    <td className="px-4 py-3"><Link href={`/ministries/${m.id}`} className="font-semibold text-primary hover:underline">{m.label}</Link></td>
                    <td className="px-4 py-3">{m.heads.length ? m.heads.map((h) => h.name).join(", ") : <span className="text-ink-3">Not assigned</span>}</td>
                    <td className="px-4 py-3">{m.assistants.length ? m.assistants.map((h) => h.name).join(", ") : <span className="text-ink-3">—</span>}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{m.members.toLocaleString("en-UG")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
