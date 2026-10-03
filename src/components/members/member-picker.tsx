"use client";

import { useEffect, useState } from "react";
import { searchMembersAction } from "@/app/(staff)/members/form-actions";

export type Picked = { id: string; memberId: string; lastName: string; firstName: string };

/** Search-as-you-type member picker (name or SDAK/M ID), scoped on the server. */
export function MemberPicker({ label, onPick, excludeId }: { label: string; onPick: (m: Picked) => void; excludeId?: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Picked[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => searchMembersAction(q, excludeId).then(setResults), 300);
    return () => clearTimeout(t);
  }, [q, excludeId]);
  const id = `picker-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <input id={id} className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or SDAK/M ID" autoComplete="off" />
      {q.trim().length >= 2 && results.length > 0 && (
        <ul className="mt-1 max-h-64 overflow-y-auto rounded-[6px] border border-line bg-surface">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="flex min-h-[44px] w-full items-center justify-between px-3 text-left hover:bg-surface-2"
                onClick={() => {
                  onPick(r);
                  setQ("");
                  setResults([]);
                }}
              >
                <span>{r.lastName}, {r.firstName}</span>
                <span className="mono text-[12px] text-ink-3">{r.memberId}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
