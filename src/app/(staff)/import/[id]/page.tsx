import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CommitButtons, MappingForm } from "@/components/import/import-forms";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { formatDateTime } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { NotFoundError, ValidationError } from "@/server/errors";
import { IMPORT_FIELD_LABELS, IMPORT_FIELDS } from "@/server/import/columns";
import { describeBatch, validateBatch } from "@/server/import/wizard";

// Validating and committing ~1,000 rows against a remote database can take a while.
export const maxDuration = 300;

export const metadata: Metadata = { title: "Import" };

const STEPS = ["Upload", "Map columns", "Validate", "Commit"];
const PAGE = 50;

function Steps({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap gap-2 text-[14px]" aria-label="Steps">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === current ? "step" : undefined}
          className={`flex items-center gap-2 rounded-full px-3 py-1.5 ${i === current ? "bg-primary text-primary-ink font-semibold" : i < current ? "bg-primary-soft text-primary" : "bg-surface-2 text-ink-2"}`}>
          <span>{i < current ? "✓" : i + 1}</span> {s}
        </li>
      ))}
    </ol>
  );
}

const SEVERITY_STYLE: Record<string, string> = {
  error: "bg-error-soft text-error",
  warning: "bg-[color-mix(in_oklab,var(--status-irregular)_15%,transparent)] text-[var(--status-irregular)]",
  info: "bg-surface-2 text-ink-2",
};

export default async function ImportBatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("import", "run");
  const { id } = await params;
  const sp = await searchParams;
  const batch = await db.importBatch.findUnique({ where: { id } });
  if (!batch) notFound();

  /* ───────── Committed: result + per-row log ───────── */
  if (batch.status === "COMMITTED") {
    const t = (batch.totals ?? {}) as Record<string, number>;
    const action = ["CREATE", "UPDATE", "UNCHANGED", "SKIP", "ERROR"].includes(sp.action ?? "") ? sp.action : undefined;
    const page = Math.max(1, Number(sp.page) || 1);
    const where = { batchId: id, ...(action ? { action: action as never } : {}) };
    const [rows, count] = await Promise.all([
      db.importRow.findMany({ where, orderBy: { rowNumber: "asc" }, take: PAGE, skip: (page - 1) * PAGE, include: { member: { select: { id: true, memberId: true, lastName: true, firstName: true } } } }),
      db.importRow.count({ where }),
    ]);
    return (
      <>
        <TopBar />
        <main className="p-4 md:p-7 space-y-6">
          <PageHeader title="Import complete" subtitle={`${batch.fileName} · committed ${batch.committedAt ? formatDateTime(batch.committedAt) : ""}`}>
            <a className="btn btn-secondary" href={`/api/import/${id}/issues`}>Download issues (CSV)</a>
            <Link className="btn btn-primary" href="/cleanup">Go to clean-up</Link>
          </PageHeader>
          <Steps current={4} />
          <div className="grid gap-3 sm:grid-cols-5">
            {[["Created", t.created], ["Updated", t.updated], ["Unchanged", t.unchanged], ["Skipped", t.skipped], ["Errors", t.errors]].map(([l, v]) => (
              <div key={l as string} className="card p-4">
                <div className="text-[13px] text-ink-2">{l}</div>
                <div className="text-[26px] font-semibold">{(v as number | undefined)?.toLocaleString("en-UG") ?? 0}</div>
              </div>
            ))}
          </div>
          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-5 py-4">
              <h2 className="mr-auto text-[17px] font-semibold">Import log · every row with its source row number</h2>
              {[undefined, "CREATE", "UPDATE", "UNCHANGED", "SKIP", "ERROR"].map((a) => (
                <Link key={a ?? "all"} href={`/import/${id}${a ? `?action=${a}` : ""}`} className={`rounded-full px-3 py-1 text-[13px] ${action === a ? "bg-primary text-primary-ink" : "bg-surface-2"}`}>
                  {a ? a.charAt(0) + a.slice(1).toLowerCase() : "All"}
                </Link>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wider text-ink-2">
                  <tr><th className="px-4 py-2.5">Row</th><th className="px-4 py-2.5">Result</th><th className="px-4 py-2.5">Member</th><th className="px-4 py-2.5">Notes</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const issues = (r.issues as { severity: string; message: string }[]) ?? [];
                    return (
                      <tr key={r.id} className="border-t border-line align-top">
                        <td className="px-4 py-2.5 mono">{r.rowNumber}</td>
                        <td className="px-4 py-2.5">{r.action?.toLowerCase()}</td>
                        <td className="px-4 py-2.5">
                          {r.member ? <Link className="text-primary hover:underline" href={`/members/${r.member.id}`}>{r.member.lastName}, {r.member.firstName} <span className="mono text-[12px] text-ink-3">{r.member.memberId}</span></Link> : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-ink-2">{issues.map((i) => i.message).join(" · ") || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[14px]">
              <span>{count.toLocaleString("en-UG")} rows</span>
              <span className="flex gap-2">
                {page > 1 && <Link className="btn btn-secondary" href={`/import/${id}?${new URLSearchParams({ ...(action ? { action } : {}), page: String(page - 1) })}`}>Previous</Link>}
                {page * PAGE < count && <Link className="btn btn-secondary" href={`/import/${id}?${new URLSearchParams({ ...(action ? { action } : {}), page: String(page + 1) })}`}>Next</Link>}
              </span>
            </div>
          </section>
        </main>
      </>
    );
  }

  /* ───────── Step 2: mapping ───────── */
  if (sp.step === "map") {
    const { workbook } = await describeBatch(db, ctx, id).catch((e) => {
      if (e instanceof NotFoundError) notFound();
      throw e;
    });
    return (
      <>
        <TopBar />
        <main className="p-4 md:p-7 space-y-6 max-w-4xl">
          <PageHeader title="Map columns" subtitle={`${batch.fileName} — check which spreadsheet column holds each field. We guessed from the headings.`} />
          <Steps current={1} />
          <MappingForm
            batchId={id}
            sheets={workbook.sheets}
            initial={{ sheetName: batch.sheetName, headerRow: batch.headerRow, columnMap: batch.columnMap as Record<string, number> }}
            fields={IMPORT_FIELDS.map((f) => ({ key: f, label: IMPORT_FIELD_LABELS[f], required: f === "lastName" || f === "firstName" }))}
          />
        </main>
      </>
    );
  }

  /* ───────── Step 3: validate + preview ───────── */
  let result;
  try {
    result = await validateBatch(db, ctx, id);
  } catch (e) {
    if (e instanceof ValidationError || e instanceof NotFoundError) {
      return (
        <>
          <TopBar />
          <main className="p-4 md:p-7 space-y-6 max-w-3xl">
            <PageHeader title="Check the mapping" />
            <Steps current={1} />
            <div className="card p-5">
              <p role="alert" className="text-error">{e.message}</p>
              <Link href={`/import/${id}?step=map`} className="btn btn-primary mt-4">Back to mapping</Link>
            </div>
          </main>
        </>
      );
    }
    throw e;
  }
  const { prepared, preview, actions } = result;
  const severity = ["error", "warning", "info"].includes(sp.severity ?? "") ? sp.severity : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const actionByRow = new Map(preview.map((p) => [p.rowNumber, p]));
  const issueRows = prepared.rows.filter((r) => r.normalized.issues.length > 0 && (!severity || r.normalized.issues.some((i) => i.severity === severity)));
  const shown = issueRows.slice((page - 1) * PAGE, page * PAGE);
  const errorRows = prepared.rows.filter((r) => !r.normalized.skip && r.normalized.issues.some((i) => i.severity === "error")).length;

  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7 space-y-6">
        <PageHeader title="Validate and preview" subtitle={`${batch.fileName} · sheet “${prepared.sheetName}”, header row ${prepared.headerRow} · ages converted as of ${prepared.agesAsOf}`}>
          <Link href={`/import/${id}?step=map`} className="btn btn-secondary">Change mapping</Link>
        </PageHeader>
        <Steps current={2} />
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[["Rows", prepared.summary.rows], ["Will create", actions.CREATE], ["Will update", actions.UPDATE], ["Unchanged", actions.UNCHANGED], ["Skipped", (actions.SKIP ?? 0)], ["Errors", actions.ERROR]].map(([l, v]) => (
            <div key={l as string} className="card p-4">
              <div className="text-[13px] text-ink-2">{l}</div>
              <div className="text-[26px] font-semibold">{((v as number | undefined) ?? 0).toLocaleString("en-UG")}</div>
            </div>
          ))}
        </div>
        <p className="text-[14px] text-ink-2">
          Nothing is guessed: values that don’t match a list (zones, ministries, roles, professions), invalid phones and unreadable dates are imported as empty and kept for the
          clean-up queues. Existing members only have empty fields filled.
        </p>

        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 px-5 py-4">
            <h2 className="mr-auto text-[17px] font-semibold">Rows with notes ({issueRows.length.toLocaleString("en-UG")})</h2>
            {[undefined, "error", "warning", "info"].map((s) => (
              <Link key={s ?? "all"} href={`/import/${id}?step=validate${s ? `&severity=${s}` : ""}`} className={`rounded-full px-3 py-1 text-[13px] ${severity === s ? "bg-primary text-primary-ink" : "bg-surface-2"}`}>
                {s ? s.charAt(0).toUpperCase() + s.slice(1) + "s" : "All"}
              </Link>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="border-t border-line p-5 text-ink-2">No rows with notes{severity ? ` of this kind` : ""}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wider text-ink-2">
                  <tr><th className="px-4 py-2.5">Row</th><th className="px-4 py-2.5">Member</th><th className="px-4 py-2.5">Will</th><th className="px-4 py-2.5">Notes</th></tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.rowNumber} className="border-t border-line align-top">
                      <td className="px-4 py-2.5 mono">{r.rowNumber}</td>
                      <td className="px-4 py-2.5">
                        {[r.normalized.columns.lastName, r.normalized.columns.firstName].filter(Boolean).join(", ") || "—"}
                        <span className="mono block text-[12px] text-ink-3">{r.raw.memberId ? String(r.raw.memberId) : "no ID"}</span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{actionByRow.get(r.rowNumber)?.action.toLowerCase()}</td>
                      <td className="px-4 py-2.5">
                        <ul className="space-y-1">
                          {r.normalized.issues.map((i, k) => (
                            <li key={k}><span className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${SEVERITY_STYLE[i.severity]}`}>{i.severity}</span>{i.message}</li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {issueRows.length > PAGE && (
            <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
              {page > 1 && <Link className="btn btn-secondary" href={`/import/${id}?step=validate${severity ? `&severity=${severity}` : ""}&page=${page - 1}`}>Previous</Link>}
              {page * PAGE < issueRows.length && <Link className="btn btn-secondary" href={`/import/${id}?step=validate${severity ? `&severity=${severity}` : ""}&page=${page + 1}`}>Next</Link>}
            </div>
          )}
        </section>

        <section className="card p-5 max-w-2xl">
          <h2 className="text-[17px] font-semibold mb-1">Commit</h2>
          <p className="text-ink-2 mb-4 text-[14px]">Every change is written to the audit log with source “import” and the spreadsheet row number. You can run the same file again later — nothing will be duplicated.</p>
          <CommitButtons batchId={id} errorRows={errorRows} total={prepared.summary.rows} />
        </section>
      </main>
    </>
  );
}
