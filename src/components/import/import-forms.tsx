"use client";

import { useRouter } from "next/navigation";
import { useActionState, useMemo, useState, useTransition } from "react";
import { commitStepAction, saveMappingAction, uploadAction } from "@/app/(staff)/import/actions";
import { SubmitButton } from "@/components/ui/form";

type Result = { ok: boolean; error?: string } | undefined;

export function UploadForm() {
  const [state, action] = useActionState<Result, FormData>(uploadAction as never, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="file" className="field-label">Register file (.xlsx, up to 10 MB)</label>
        <input id="file" name="file" type="file" required accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="input pt-2.5" />
      </div>
      {state && !state.ok && <p role="alert" className="rounded-[6px] bg-error-soft px-3 py-2 text-[14px] text-error">{state.error}</p>}
      <SubmitButton className="btn btn-primary" pendingText="Reading the file…">Upload and continue</SubmitButton>
    </form>
  );
}

type SheetInfo = {
  name: string;
  rowCount: number;
  headerRow: number | null;
  detected: Record<string, number>;
  preview: { rowNumber: number; cells: string[] }[];
};

export function MappingForm({
  batchId,
  sheets,
  initial,
  fields,
}: {
  batchId: string;
  sheets: SheetInfo[];
  initial: { sheetName: string; headerRow: number; columnMap: Record<string, number> };
  fields: { key: string; label: string; required?: boolean }[];
}) {
  const [sheetName, setSheetName] = useState(initial.sheetName || sheets[0]?.name);
  const sheet = sheets.find((s) => s.name === sheetName) ?? sheets[0];
  const [headerRow, setHeaderRow] = useState(initial.headerRow || sheet?.headerRow || 1);
  const [map, setMap] = useState<Record<string, number>>(initial.columnMap);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const headerCells = useMemo(() => sheet?.preview.find((r) => r.rowNumber === headerRow)?.cells ?? [], [sheet, headerRow]);
  const columns = headerCells.map((h, i) => ({ col: i, label: h ? `${String.fromCharCode(64 + i)} · ${h}` : `Column ${String.fromCharCode(64 + i)}` })).filter((c) => c.col > 0);
  const used = new Map(Object.entries(map).map(([f, c]) => [c, f]));

  function changeSheet(name: string) {
    setSheetName(name);
    const s = sheets.find((x) => x.name === name);
    setHeaderRow(s?.headerRow ?? 1);
    setMap(s?.detected ?? {});
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await saveMappingAction(batchId, { sheetName, headerRow, columnMap: map as never });
          if (r && !r.ok) setError(r.error);
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="sheet" className="field-label">Sheet</label>
          <select id="sheet" className="input" value={sheetName} onChange={(e) => changeSheet(e.target.value)}>
            {sheets.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.rowCount} rows)</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="header" className="field-label">Header row</label>
          <select id="header" className="input" value={headerRow} onChange={(e) => setHeaderRow(Number(e.target.value))}>
            {sheet?.preview.map((r) => (
              <option key={r.rowNumber} value={r.rowNumber}>
                Row {r.rowNumber}: {r.cells.filter(Boolean).slice(0, 4).join(" · ").slice(0, 60)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-[14px]">
          <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wider text-ink-2">
            <tr>
              <th className="px-4 py-2.5">Field in SDAK Church Manager</th>
              <th className="px-4 py-2.5">Column in the spreadsheet</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.key} className="border-t border-line">
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  {f.label}
                  {f.required && <span className="ml-1 text-error">*</span>}
                </th>
                <td className="px-4 py-2">
                  <select
                    aria-label={`Column for ${f.label}`}
                    className="input"
                    value={map[f.key] ?? ""}
                    onChange={(e) => {
                      const next = { ...map };
                      if (e.target.value === "") delete next[f.key];
                      else next[f.key] = Number(e.target.value);
                      setMap(next);
                    }}
                  >
                    <option value="">— Not in this file —</option>
                    {columns.map((c) => (
                      <option key={c.col} value={c.col} disabled={used.has(c.col) && used.get(c.col) !== f.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p role="alert" className="rounded-[6px] bg-error-soft px-3 py-2 text-[14px] text-error">{error}</p>}
      <button className="btn btn-primary" disabled={pending}>{pending ? "Checking every row…" : "Validate"}</button>
    </form>
  );
}

export function CommitButtons({ batchId, errorRows, total, alreadyWritten = 0 }: { batchId: string; errorRows: number; total: number; alreadyWritten?: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ written: number; total: number } | null>(alreadyWritten ? { written: alreadyWritten, total } : null);
  const [error, setError] = useState<string | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const resuming = alreadyWritten > 0;

  // Commit in rounds (each well inside the server's time limit) until every row is written.
  const commit = async (skip: boolean) => {
    setRunning(true);
    setError(null);
    try {
      for (let round = 0; round < 200; round++) {
        let r;
        try {
          r = await commitStepAction(batchId, skip);
        } catch {
          setError("The connection dropped. Nothing is lost — press Continue to carry on from where it stopped.");
          return;
        }
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setProgress({ written: r.data!.written, total: r.data!.total });
        if (r.data!.done) {
          router.push(`/import/${batchId}`);
          router.refresh();
          return;
        }
      }
    } finally {
      setRunning(false);
    }
  };
  const pct = progress ? Math.round((progress.written / Math.max(progress.total, 1)) * 100) : 0;
  return (
    <div className="space-y-3">
      {resuming && !running && (
        <p className="rounded-[6px] bg-primary-soft px-3 py-2 text-[14px] text-primary">
          This import stopped part-way: {alreadyWritten.toLocaleString("en-UG")} of {total.toLocaleString("en-UG")} rows are already in. Continue to add the rest — rows already imported are not repeated.
        </p>
      )}
      {errorRows > 0 && !resuming && (
        <label className="flex min-h-[44px] items-start gap-2 text-[14px]">
          <input type="checkbox" className="mt-1 size-4" checked={confirmSkip} onChange={(e) => setConfirmSkip(e.target.checked)} />
          Import the other {total - errorRows} rows and skip the {errorRows} row{errorRows === 1 ? "" : "s"} with errors (they’re listed in the import log)
        </label>
      )}
      {progress && (running || progress.written > 0) && (
        <div aria-live="polite">
          <div className="flex justify-between text-[13px] text-ink-2">
            <span>{running ? "Importing — keep this page open…" : "Progress"}</span>
            <span className="tabular-nums">{progress.written.toLocaleString("en-UG")} of {progress.total.toLocaleString("en-UG")} rows</span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Import progress">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(pct, 2)}%` }} />
          </div>
        </div>
      )}
      <button
        type="button"
        className="btn btn-primary"
        disabled={running || (errorRows > 0 && !confirmSkip && !resuming)}
        onClick={() => commit(errorRows > 0)}
      >
        {running ? "Importing…" : resuming || error ? "Continue import" : "Commit import"}
      </button>
      {error && <p role="alert" className="rounded-[6px] bg-error-soft px-3 py-2 text-[14px] text-error">{error}</p>}
    </div>
  );
}
