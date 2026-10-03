"use client";

import { useEffect, useId, useRef, useState } from "react";
import { searchMembersAction } from "@/app/(staff)/members/form-actions";

export type Picked = { id: string; memberId: string; lastName: string; firstName: string; zone?: string | null };

/**
 * Searchable dropdown (combobox) over the member directory: type a name or
 * SDAK/M ID, pick with the mouse or arrow keys + Enter. Results come from the
 * server and respect the user's member scope.
 */
export function MemberPicker({
  label,
  onPick,
  excludeId,
  excludeIds = [],
  placeholder = "Search by name or SDAK/M ID…",
}: {
  label: string;
  onPick: (m: Picked) => void;
  excludeId?: string;
  excludeIds?: string[];
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Picked[]>([]);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const listId = `${id}-list`;
  const exclude = excludeIds.join(",");

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) return;
    let stale = false;
    const t = setTimeout(() => {
      setLoading(true);
      searchMembersAction(text, excludeId, exclude ? exclude.split(",") : [])
        .then((r) => {
          if (stale) return;
          setResults(r);
          setActive(0);
        })
        .finally(() => !stale && setLoading(false));
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q, excludeId, exclude]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (m: Picked) => {
    onPick(m);
    setQ("");
    setResults([]);
    setOpen(false);
  };
  const short = q.trim().length < 2;
  const shown = short ? [] : results;

  return (
    <div ref={box} className="relative">
      <label htmlFor={id} className="field-label">{label}</label>
      <div className="relative">
        <svg viewBox="0 0 24 24" aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-ink-3" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </svg>
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
          className="input pl-10 pr-9"
          value={q}
          placeholder={placeholder}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, Math.max(shown.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && open && shown[active]) {
              e.preventDefault();
              pick(shown[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {loading && <span aria-hidden className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin rounded-full border-2 border-line border-t-primary" />}
      </div>
      {open && (
        <div id={listId} role="listbox" aria-label={label} className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-[8px] border border-line bg-surface py-1 shadow-lg">
          {short ? (
            <p className="px-3 py-2.5 text-[14px] text-ink-2">Type at least 2 letters of a name, or a member ID like M0123.</p>
          ) : loading && results.length === 0 ? (
            <p className="px-3 py-2.5 text-[14px] text-ink-2">Searching…</p>
          ) : shown.length === 0 ? (
            <p className="px-3 py-2.5 text-[14px] text-ink-2">No members match “{q.trim()}”.</p>
          ) : (
            shown.map((r, i) => (
              <button
                key={r.id}
                id={`${listId}-${i}`}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(r)}
                className={`flex min-h-[44px] w-full items-center justify-between gap-3 px-3 text-left ${i === active ? "bg-primary-soft" : ""}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.lastName}, {r.firstName}</span>
                  {r.zone && <span className="block truncate text-[12px] text-ink-2">{r.zone}</span>}
                </span>
                <span className="mono shrink-0 text-[12px] text-ink-3">{r.memberId}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** A chosen member with a way to change the choice. */
export function PickedMember({ member, onClear, label }: { member: Picked; onClear: () => void; label: string }) {
  return (
    <div>
      <span className="field-label">{label}</span>
      <div className="flex min-h-[44px] items-center justify-between gap-3 rounded-[6px] border border-primary/50 bg-primary-soft px-3">
        <span className="min-w-0 truncate">
          <span className="font-semibold">{member.lastName}, {member.firstName}</span>{" "}
          <span className="mono text-[12px] text-ink-2">{member.memberId}</span>
        </span>
        <button type="button" className="min-h-[36px] shrink-0 text-[14px] font-semibold text-primary" onClick={onClear}>Change</button>
      </div>
    </div>
  );
}
