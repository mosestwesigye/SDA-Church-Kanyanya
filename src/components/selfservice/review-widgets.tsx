"use client";

import { useState } from "react";
import { decideCorrectionAction } from "@/app/(staff)/self-service-requests/actions";
import { Msg, useRun } from "@/components/ui/use-run";

type Row = { field: string; label: string; from: string; to: string; now: string };

/** Diff review: tick the changes to apply, then approve; or reject with a reason the member will see. */
export function ReviewCorrection({ id, rows, memberName }: { id: string; rows: Row[]; memberName: string }) {
  const [chosen, setChosen] = useState<string[]>(rows.map((r) => r.field));
  const [note, setNote] = useState("");
  const { pending, msg, run } = useRun();
  return (
    <div>
      <table className="w-full text-[14px]">
        <caption className="sr-only">Requested changes for {memberName}</caption>
        <thead className="text-left text-[11px] uppercase tracking-wider text-ink-2">
          <tr>
            <th scope="col" className="w-10 py-2"><span className="sr-only">Apply</span></th>
            <th scope="col" className="py-2">Field</th>
            <th scope="col" className="py-2">On record now</th>
            <th scope="col" className="py-2">Requested</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const stale = r.now !== r.from;
            return (
              <tr key={r.field} className="border-t border-line align-top">
                <td className="py-2">
                  <input type="checkbox" className="size-5" aria-label={`Apply ${r.label}`} checked={chosen.includes(r.field)}
                    onChange={(e) => setChosen(e.target.checked ? [...chosen, r.field] : chosen.filter((f) => f !== r.field))} />
                </td>
                <th scope="row" className="py-2 pr-3 text-left font-semibold">{r.label}</th>
                <td className="py-2 pr-3">
                  <span className="text-ink-2 line-through decoration-error/60">{r.now || "—"}</span>
                  {stale && <span className="block text-[12px] text-[var(--status-irregular)]">Changed since the request (was “{r.from || "—"}”)</span>}
                </td>
                <td className="py-2"><span className="rounded bg-primary-soft px-1.5 py-0.5 font-semibold text-primary">{r.to || "— (clear)"}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[240px] flex-1">
          <label className="field-label" htmlFor={`n-${id}`}>Note to the member (required to reject)</label>
          <input id={`n-${id}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </div>
        <button type="button" className="btn btn-primary" disabled={pending || chosen.length === 0} onClick={() => run(() => decideCorrectionAction(id, true, chosen, note))}>
          Approve {chosen.length === rows.length ? "all" : `${chosen.length} of ${rows.length}`}
        </button>
        <button type="button" className="btn btn-danger" disabled={pending || !note.trim()} onClick={() => run(() => decideCorrectionAction(id, false, [], note))}>Reject</button>
      </div>
      <div className="mt-2"><Msg msg={msg} /></div>
    </div>
  );
}
