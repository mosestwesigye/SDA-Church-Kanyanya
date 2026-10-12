"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { activateAction, requestReactivationAction } from "@/app/(staff)/dormant/actions";
import { StatusBadge } from "@/components/ui/badges";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/lib/toast";

export type DormantRow = {
  id: string;
  memberId: string;
  name: string;
  status: string | null;
  zone: string | null;
  phone: string | null;
  completeness: number | null;
  pendingTo: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);

function ReactivateDialog({ row, onClose }: { row: DormantRow; onClose: () => void }) {
  const router = useRouter();
  const [toStatus, setTo] = useState<"ACTIVE" | "IRREGULAR">("ACTIVE");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today());
  const [pending, start] = useTransition();
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Reactivate ${row.name}`}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || reason.trim().length < 5}
            onClick={() =>
              start(async () => {
                const r = await requestReactivationAction({ memberId: row.id, toStatus, reason, effectiveDate: date });
                toast.result(r);
                if (r.ok) {
                  onClose();
                  router.refresh();
                }
              })
            }
          >
            {pending ? "Sending…" : "Send for approval"}
          </button>
        </>
      }
    >
      <p className="text-[14px] text-ink-2">
        {row.memberId} is currently <strong className="text-ink">{row.status ? row.status.replace(/_/g, " ").toLowerCase() : "not recorded"}</strong>. Changing an existing status needs the Pastor’s approval; the member appears in reports once it is approved.
      </p>
      <fieldset className="mt-4">
        <legend className="field-label">New status</legend>
        <div className="flex gap-4">
          {(["ACTIVE", "IRREGULAR"] as const).map((s) => (
            <label key={s} className="flex min-h-[44px] items-center gap-2">
              <input type="radio" name="to" checked={toStatus === s} onChange={() => setTo(s)} className="size-4 accent-[var(--primary)]" />
              {s === "ACTIVE" ? "Active" : "Irregular"}
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor="re-reason" className="field-label mt-3">Reason</label>
      <textarea id="re-reason" className="input min-h-[90px] py-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Returned and attending regularly since August" />
      <label htmlFor="re-date" className="field-label mt-3">Effective date</label>
      <input id="re-date" type="date" className="input max-w-xs" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
    </Dialog>
  );
}

export function DormantTable({ rows, canActivate, canRequest }: { rows: DormantRow[]; canActivate: boolean; canRequest: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DormantRow | null>(null);
  const [pending, start] = useTransition();
  const selectable = rows.filter((r) => r.status === null && canActivate);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));

  const activate = (ids: string[], status: "ACTIVE" | "IRREGULAR") =>
    start(async () => {
      const r = await activateAction(ids, status);
      toast.result(r);
      if (r.ok) {
        setSelected(new Set());
        router.refresh();
      }
    });

  return (
    <>
      {selected.size > 0 && (
        <div className="sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-[8px] bg-primary px-4 py-2.5 text-primary-ink">
          <span className="mr-2 font-semibold">{selected.size} selected</span>
          <button type="button" disabled={pending} className="min-h-[36px] rounded-[6px] bg-white/15 px-3 text-[14px] font-semibold hover:bg-white/25" onClick={() => activate([...selected], "ACTIVE")}>Mark Active</button>
          <button type="button" disabled={pending} className="min-h-[36px] rounded-[6px] bg-white/15 px-3 text-[14px] font-semibold hover:bg-white/25" onClick={() => activate([...selected], "IRREGULAR")}>Mark Irregular</button>
          <button type="button" className="ml-auto min-h-[36px] px-2 text-[14px] underline" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wider text-ink-2">
            <tr>
              <th className="w-10 px-3 py-3">
                {selectable.length > 0 && (
                  <input
                    type="checkbox"
                    aria-label="Select all members without a status on this page"
                    className="size-4"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.id)))}
                  />
                )}
              </th>
              <th className="px-3 py-3">Member</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Zone</th>
              <th className="px-3 py-3">Phone</th>
              <th className="px-3 py-3">Record</th>
              <th className="px-3 py-3 text-right">Update status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t border-line align-middle ${selected.has(r.id) ? "bg-primary-soft/50" : ""}`}>
                <td className="px-3 py-2.5">
                  {r.status === null && canActivate && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.name}`}
                      className="size-4"
                      checked={selected.has(r.id)}
                      onChange={() => {
                        const next = new Set(selected);
                        if (next.has(r.id)) next.delete(r.id);
                        else next.add(r.id);
                        setSelected(next);
                      }}
                    />
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <Link href={`/members/${r.id}`} className="whitespace-nowrap font-semibold hover:underline">{r.name}</Link>
                  <span className="mono block text-[12px] text-ink-3">{r.memberId}</span>
                </td>
                <td className="px-3 py-2.5"><StatusBadge status={r.status as never} /></td>
                <td className="px-3 py-2.5">{r.zone ?? <span className="text-ink-3">—</span>}</td>
                <td className="whitespace-nowrap px-3 py-2.5">{r.phone ?? <span className="text-ink-3">—</span>}</td>
                <td className="px-3 py-2.5 text-ink-2">{r.completeness !== null ? `${r.completeness}% complete` : "—"}</td>
                <td className="px-3 py-2.5 text-right">
                  {r.status === "DECEASED" ? (
                    <span className="text-[13px] text-ink-3">Kept for the record</span>
                  ) : r.pendingTo ? (
                    <Link href="/transfers" className="inline-flex rounded-full bg-[color-mix(in_srgb,var(--status-irregular)_16%,transparent)] px-2.5 py-1 text-[12px] font-semibold text-[var(--status-irregular)]">
                      Awaiting approval → {r.pendingTo === "ACTIVE" ? "Active" : "Irregular"}
                    </Link>
                  ) : r.status === null ? (
                    canActivate && (
                      <span className="inline-flex gap-2">
                        <button type="button" disabled={pending} className="btn btn-primary h-9 min-h-9 px-3 text-[13px]" onClick={() => activate([r.id], "ACTIVE")}>Active</button>
                        <button type="button" disabled={pending} className="btn btn-secondary h-9 min-h-9 px-3 text-[13px]" onClick={() => activate([r.id], "IRREGULAR")}>Irregular</button>
                      </span>
                    )
                  ) : (
                    canRequest && <button type="button" className="btn btn-secondary h-9 min-h-9 px-3 text-[13px]" onClick={() => setDialog(r)}>Request reactivation</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dialog && <ReactivateDialog row={dialog} onClose={() => setDialog(null)} />}
    </>
  );
}
