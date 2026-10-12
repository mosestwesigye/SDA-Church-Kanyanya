"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { activateAction } from "@/app/(staff)/dormant/actions";
import { StatusBadge } from "@/components/ui/badges";
import { STATUS_META } from "@/lib/labels";
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

export function DormantTable({ rows, canActivate, canChange }: { rows: DormantRow[]; canActivate: boolean; canChange: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  // A first status needs profile editing rights; changing an existing one needs the status-change permission.
  const canUpdate = (r: DormantRow) => r.status !== "DECEASED" && !r.pendingTo && (r.status === null ? canActivate : canChange);
  const selectable = rows.filter(canUpdate);
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
                    aria-label="Select all members on this page"
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
                  {canUpdate(r) && (
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
                      Unfinished request → {STATUS_META[r.pendingTo as keyof typeof STATUS_META]?.label ?? r.pendingTo}
                    </Link>
                  ) : (
                    canUpdate(r) && (
                      <span className="inline-flex gap-2">
                        <button type="button" disabled={pending} className="btn btn-primary h-9 min-h-9 px-3 text-[13px]" onClick={() => activate([r.id], "ACTIVE")}>Active</button>
                        <button type="button" disabled={pending} className="btn btn-secondary h-9 min-h-9 px-3 text-[13px]" onClick={() => activate([r.id], "IRREGULAR")}>Irregular</button>
                      </span>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
