"use client";

import { useEffect, useRef, useState } from "react";

/** Pill filter from the design ("Status Any") with a checkbox popover. */
export function FilterMenu({
  label,
  options,
  selected,
  onChange,
  multi = true,
}: {
  label: string;
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  multi?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const summary =
    selected.length === 0 ? "Any" : selected.length === 1 ? (options.find((o) => o.id === selected[0])?.label ?? "1") : `${selected.length} selected`;

  function toggle(id: string) {
    if (!multi) return onChange(selected[0] === id ? [] : [id]);
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className={`h-10 rounded-[6px] border px-3 text-[14px] whitespace-nowrap ${selected.length ? "border-primary bg-primary-soft" : "border-line bg-surface"}`}
      >
        <span className="text-ink-2">{label}</span> <span className="font-semibold">{summary}</span>
      </button>
      {open && (
        <div role="group" aria-label={label} className="absolute z-30 mt-1 max-h-80 w-64 overflow-y-auto rounded-[8px] border border-line bg-surface p-2 shadow-lg">
          {options.map((o) => (
            <label key={o.id} className="flex min-h-[40px] cursor-pointer items-center gap-3 rounded px-2 hover:bg-surface-2">
              <input type={multi ? "checkbox" : "radio"} checked={selected.includes(o.id)} onChange={() => toggle(o.id)} className="size-4 accent-[var(--primary)]" />
              <span className="text-[14px]">{o.label}</span>
            </label>
          ))}
          {selected.length > 0 && (
            <button type="button" className="mt-1 w-full min-h-[40px] text-[14px] text-primary" onClick={() => onChange([])}>
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
