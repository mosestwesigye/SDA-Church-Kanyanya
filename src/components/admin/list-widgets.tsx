"use client";

import { useState } from "react";
import { addListItemAction, renameListItemAction, setListItemActiveAction } from "@/app/(staff)/admin/actions";
import { Msg, useRun } from "@/components/ui/use-run";
import type { ListType } from "@/generated/prisma/enums";

export function AddItem({ type, noun }: { type: ListType; noun: string }) {
  const [label, setLabel] = useState("");
  const { pending, msg, run } = useRun();
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => addListItemAction(type, label), () => setLabel("")); }}>
      <div className="min-w-[220px] flex-1">
        <label className="field-label" htmlFor={`add-${type}`}>New {noun}</label>
        <input id={`add-${type}`} className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
      </div>
      <button className="btn btn-primary" disabled={pending || label.trim().length < 2}>Add</button>
      <div className="basis-full"><Msg msg={msg} /></div>
    </form>
  );
}

export function ItemRow({ id, label, active, used }: { id: string; label: string; active: boolean; used: number }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label);
  const { pending, msg, run } = useRun();
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2 last:border-0">
      {editing ? (
        <form className="flex flex-1 flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(() => renameListItemAction(id, value), () => setEditing(false)); }}>
          <label className="sr-only" htmlFor={`rn-${id}`}>Name</label>
          <input id={`rn-${id}`} className="input h-10 min-h-10 max-w-xs" value={value} onChange={(e) => setValue(e.target.value)} autoFocus maxLength={60} />
          <button className="btn btn-primary" disabled={pending}>Save</button>
          <button type="button" className="btn btn-secondary" onClick={() => { setEditing(false); setValue(label); }}>Cancel</button>
        </form>
      ) : (
        <span className={`flex-1 ${active ? "" : "text-ink-3 line-through"}`}>{label}</span>
      )}
      <span className="w-28 text-right text-[13px] text-ink-2 tabular-nums">{used.toLocaleString("en-UG")} member{used === 1 ? "" : "s"}</span>
      {!editing && (
        <span className="flex">
          <button type="button" className="min-h-[44px] px-2 text-[14px] text-primary" onClick={() => setEditing(true)} aria-label={`Rename ${label}`}>Rename</button>
          <button type="button" className="min-h-[44px] px-2 text-[14px]" disabled={pending} onClick={() => run(() => setListItemActiveAction(id, !active))} aria-label={`${active ? "Hide" : "Show"} ${label}`}>
            {active ? "Hide" : "Show"}
          </button>
        </span>
      )}
      <div className="basis-full empty:hidden"><Msg msg={msg} /></div>
    </li>
  );
}
