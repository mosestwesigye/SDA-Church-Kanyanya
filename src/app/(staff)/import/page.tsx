import type { Metadata } from "next";
import Link from "next/link";
import { UploadForm } from "@/components/import/import-forms";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { formatDateTime } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

// Validating and committing ~1,000 rows against a remote database can take a while.
export const maxDuration = 300;

export const metadata: Metadata = { title: "Import" };

const STEPS = ["Upload", "Map columns", "Validate", "Commit"];

export default async function ImportPage() {
  await requirePermission("import", "run");
  const batches = await db.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  const users = new Map((await db.user.findMany({ where: { id: { in: batches.map((b) => b.createdById).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7 space-y-6">
        <PageHeader title="Import the register" subtitle="Bring members in from the clerk’s Excel register. Safe to re-run: existing members are matched by ID and only empty fields are filled." />
        <ol className="flex flex-wrap gap-2 text-[14px]" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s} className={`flex items-center gap-2 rounded-full px-3 py-1.5 ${i === 0 ? "bg-primary text-primary-ink font-semibold" : "bg-surface-2 text-ink-2"}`}>
              <span>{i + 1}</span> {s}
            </li>
          ))}
        </ol>
        <section className="card p-5 max-w-xl">
          <UploadForm />
          <p className="mt-4 text-[13px] text-ink-2">
            The file contains personal data. It is stored privately for this import only, and nothing changes in the membership records until you commit.
          </p>
        </section>

        <section className="card overflow-hidden">
          <h2 className="px-5 py-4 text-[17px] font-semibold">Previous imports</h2>
          {batches.length === 0 ? (
            <p className="border-t border-line p-5 text-ink-2">No imports yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wider text-ink-2">
                  <tr>
                    <th className="px-4 py-2.5">File</th>
                    <th className="px-4 py-2.5">By</th>
                    <th className="px-4 py-2.5">When</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => {
                    const t = (b.totals ?? {}) as Record<string, number>;
                    return (
                      <tr key={b.id} className="border-t border-line">
                        <td className="px-4 py-2.5">
                          <Link href={`/import/${b.id}${b.status === "COMMITTED" ? "" : "?step=validate"}`} className="font-semibold text-primary hover:underline">{b.fileName}</Link>
                        </td>
                        <td className="px-4 py-2.5">{b.createdById ? (users.get(b.createdById) ?? "—") : "System"}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap">{formatDateTime(b.committedAt ?? b.createdAt)}</td>
                        <td className="px-4 py-2.5">{b.status === "COMMITTED" ? "Committed" : t.inProgress ? `Partly imported (${t.written ?? 0} of ${t.total ?? "?"}) — open to continue` : b.status === "VALIDATED" ? "Validated, not committed" : "Uploaded"}</td>
                        <td className="px-4 py-2.5 text-ink-2">
                          {b.status === "COMMITTED" ? `${t.created ?? 0} created · ${t.updated ?? 0} updated · ${t.unchanged ?? 0} unchanged · ${(t.skipped ?? 0) + (t.errors ?? 0)} skipped` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
