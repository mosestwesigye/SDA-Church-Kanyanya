"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { mapValuesAction } from "@/app/(staff)/cleanup/actions";
import type { Option } from "@/components/members/types";

export type GroupView = {
  key: string;
  field: string;
  fieldLabel: string;
  listField: boolean;
  suggestion: { kind: "blank" } | { kind: "item"; id: string; label: string } | null;
  values: { normalized: string; examples: string[]; count: number }[];
  total: number;
};

/** One group of non-standard values with bulk "Replace with" (design 1d). */
export function ValueGroup({ g, options, canAddNew, compact = false, nextLabel }: { g: GroupView; options: Option[]; canAddNew: boolean; compact?: boolean; nextLabel?: string }) {
  const router = useRouter();
  const [checked, setChecked] = useState<Set<string>>(new Set(g.values.map((v) => v.normalized)));
  // No silent default: unmatched values need an explicit choice (a real place name shouldn't be blanked by accident).
  const [target, setTarget] = useState<string>(g.suggestion?.kind === "item" ? g.suggestion.id : g.suggestion?.kind === "blank" || !g.listField ? "blank" : "");
  const [newLabel, setNewLabel] = useState("");
  const [remember, setRemember] = useState(true);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const count = g.values.filter((v) => checked.has(v.normalized)).reduce((n, v) => n + v.count, 0);

  function apply() {
    const t = target === "blank" ? { kind: "blank" as const } : target === "new" ? { kind: "new" as const, label: newLabel } : { kind: "item" as const, id: target };
    start(async () => {
      const r = await mapValuesAction({ field: g.field as never, normalized: [...checked], target: t, remember });
      setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "Done.") : (r.error ?? "Failed.") });
      if (r.ok) router.refresh();
    });
  }

  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-semibold">{compact ? "Non-standard values" : g.suggestion?.kind === "item" ? `Likely “${g.suggestion.label}”` : g.suggestion?.kind === "blank" ? "Means “not recorded”" : "Unmatched value"}</h2>
        <span className="text-[13px] text-ink-2">Field: {g.fieldLabel}</span>
      </div>
      <ul className="mt-3 space-y-1">
        {g.values.map((v) => (
          <li key={v.normalized}>
            <label className="flex min-h-[36px] items-center gap-3">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={checked.has(v.normalized)}
                onChange={() => {
                  const n = new Set(checked);
                  if (n.has(v.normalized)) n.delete(v.normalized);
                  else n.add(v.normalized);
                  setChecked(n);
                }}
              />
              <span className="mono flex-1">{v.examples.map((e) => `“${e}”`).join(", ")}</span>
              <span className="text-[13px] text-ink-2 whitespace-nowrap">{v.count} record{v.count === 1 ? "" : "s"}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-line pt-4">
        <label className="flex flex-wrap items-center gap-3">
          <span className="text-[14px] text-ink-2">{g.listField ? "Replace with" : "Action"}</span>
          <select className="input flex-1 min-w-48" value={target} onChange={(e) => setTarget(e.target.value)}>
            {g.listField && <option value="">Choose…</option>}
            <option value="blank">{g.listField ? "Not recorded (blank)" : "Nothing — mark as handled"}</option>
            {g.listField && options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            {g.listField && canAddNew && <option value="new">Add as a new list value…</option>}
          </select>
        </label>
        {target === "new" && <input className="input mt-2" placeholder="New value, e.g. Lusanja" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />}
        {g.listField && (
          <label className="mt-2 flex min-h-[36px] items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4" />
            Remember for future imports
          </label>
        )}
        <button type="button" className="btn btn-secondary mt-2 w-full border-primary text-primary" disabled={pending || count === 0 || target === "" || (target === "new" && newLabel.trim().length < 2)} onClick={apply}>
          {pending ? "Applying…" : g.listField ? `Apply to ${count} record${count === 1 ? "" : "s"}` : `Mark ${count} as handled`}
        </button>
        {!g.listField && <p className="mt-2 text-[12px] text-ink-3">The member records are not changed. Fix the value on each record first if it should be kept.</p>}
        {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-[13px] ${msg.ok ? "text-ok" : "text-error"}`}>{msg.text}</p>}
        {nextLabel && <p className="mt-3 text-[13px] text-ink-2">Next group: {nextLabel}</p>}
      </div>
    </section>
  );
}
