"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dismissDuplicateAction, mergeAction } from "@/app/(staff)/cleanup/actions";

export type CompareRecord = {
  id: string;
  memberId: string;
  values: Record<string, string | null>; // MergeField → display text
};

export const FIELD_LABELS: Record<string, string> = {
  lastName: "Last name", firstName: "First name", gender: "Gender", dob: "DOB", yearJoined: "Joined", photo: "Photo",
  zone: "Zone", phone: "Phone", email: "Email", status: "Status", maritalStatus: "Marital", spouse: "Spouse",
  nextOfKin: "Next of kin", profession: "Profession", ministries: "Ministry",
};

/** Side-by-side compare with per-field choice of the value to keep (design 1d). */
export function DuplicateCompare({
  a,
  b,
  reasons,
  position,
  total,
  prevHref,
  nextHref,
  canMerge,
  compact = false,
}: {
  a: CompareRecord;
  b: CompareRecord;
  reasons: string[];
  position: number;
  total: number;
  prevHref?: string;
  nextHref?: string;
  canMerge: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [survivor, setSurvivor] = useState<"a" | "b">(() => (Number(a.memberId.replace(/\D/g, "")) <= Number(b.memberId.replace(/\D/g, "")) ? "a" : "b"));
  const keep = survivor === "a" ? a : b;
  const other = survivor === "a" ? b : a;
  const fields = Object.keys(FIELD_LABELS).filter((f) => a.values[f] !== undefined && (a.values[f] || b.values[f]));
  const initialChoice = (f: string) => (!keep.values[f] && other.values[f] ? "retired" : "survivor");
  const [choices, setChoices] = useState<Record<string, "survivor" | "retired">>({});
  const choice = (f: string) => choices[f] ?? initialChoice(f);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "Done.") : (r.error ?? "Failed.") });
      if (r.ok) router.refresh();
    });
  }

  const col = (rec: CompareRecord, side: "survivor" | "retired") =>
    fields.map((f) => {
      const chosen = f === "ministries" ? true : choice(f) === side;
      const v = rec.values[f];
      return (
        <td key={f} className={`px-3 py-2 ${chosen && v ? "bg-primary-soft" : ""}`}>
          {f === "ministries" ? (
            v ?? "—"
          ) : (
            <label className="flex cursor-pointer items-center gap-2">
              {!compact && canMerge && (
                <input
                  type="radio"
                  name={`f-${f}`}
                  checked={choice(f) === side}
                  onChange={() => setChoices({ ...choices, [f]: side })}
                  className="size-4 accent-[var(--primary)]"
                  aria-label={`Keep ${FIELD_LABELS[f]} from ${rec.memberId}`}
                />
              )}
              <span className={v ? "" : "text-ink-3"}>{v ?? "—"}</span>
            </label>
          )}
        </td>
      );
    });

  return (
    <section className="card p-5" aria-label="Suspected duplicate">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-semibold">Suspected duplicate</h2>
        <span className="flex items-center gap-2 text-[13px] text-ink-2">
          {prevHref && <Link href={prevHref} className="min-h-[36px] px-1 text-primary" aria-label="Previous pair">‹</Link>}
          {position} of {total}
          {nextHref && <Link href={nextHref} className="min-h-[36px] px-1 text-primary" aria-label="Next pair">›</Link>}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {reasons.map((r) => (
          <span key={r} className="rounded bg-surface-2 px-2 py-0.5 text-[12px]">{r}</span>
        ))}
      </div>
      <div className="mt-3 overflow-x-auto rounded-[8px] border border-line">
        <table className="w-full text-[14px]">
          <thead className="bg-surface-2 text-left">
            <tr>
              <th className="px-3 py-2" />
              {[keep, other].map((rec, i) => (
                <th key={rec.id} className="px-3 py-2">
                  <Link href={`/members/${rec.id}`} target="_blank" className="mono font-semibold hover:underline">{rec.memberId.replace("SDAK/", "")}</Link>
                  {i === 0 ? <span className="ml-1 font-normal text-ink-2">· keep</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={f} className="border-t border-line">
                <th scope="row" className="px-3 py-2 text-left font-normal text-ink-2">{FIELD_LABELS[f]}</th>
                {col(keep, "survivor")[i]}
                {col(other, "retired")[i]}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[13px] text-ink-2">
        Highlighted values are kept. {other.memberId.replace("SDAK/", "")} will be retired and never reused. Merge can be undone for 30 days. Ministries,
        documents and history from both records are kept.
      </p>
      {canMerge && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary flex-1" disabled={pending} onClick={() => run(() => mergeAction(keep.id, other.id, Object.fromEntries(fields.filter((f) => f !== "ministries").map((f) => [f, choice(f)]))))}>
            Merge into {keep.memberId.replace("SDAK/", "")}
          </button>
          {!compact && (
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => (setSurvivor(survivor === "a" ? "b" : "a"), setChoices({}))}>
              Keep {other.memberId.replace("SDAK/", "")} instead
            </button>
          )}
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => run(() => dismissDuplicateAction(a.id, b.id))}>
            Not a duplicate
          </button>
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-[13px] ${msg.ok ? "text-ok" : "text-error"}`}>{msg.text}</p>}
    </section>
  );
}
