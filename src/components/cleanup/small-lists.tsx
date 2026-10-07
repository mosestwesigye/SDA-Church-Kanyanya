"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { maskUgPhoneInput, normalizeUgPhone } from "@/lib/phone";
import { quickSaveAction, resolveFlagAction, setTargetAction, undoMergeAction } from "@/app/(staff)/cleanup/actions";
import { toast } from "@/lib/toast";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      toast.result(r, "Saved.");
      setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "Done.") : (r.error ?? "Failed.") });
      if (r.ok) router.refresh();
    });
  return { pending, msg, run };
}

export function PhoneFixRow({ r }: { r: { id: string; memberId: string; name: string; version: number; phoneRaw: string | null } }) {
  const [phone, setPhone] = useState("");
  const { pending, msg, run } = useAct();
  const bad = phone !== "" && !normalizeUgPhone(phone)?.valid;
  return (
    <form
      className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!bad && phone) run(() => quickSaveAction(r.id, r.version, { phone }));
      }}
    >
      <span className="min-w-48 flex-1">
        <Link href={`/members/${r.id}`} className="font-semibold hover:underline">{r.name}</Link>
        <span className="mono block text-[12px] text-ink-3">{r.memberId}</span>
      </span>
      <span className="mono w-40 text-[14px] text-error line-through decoration-1">{r.phoneRaw ?? "—"}</span>
      <input aria-label={`Corrected phone for ${r.name}`} aria-invalid={bad} className="input w-44" placeholder="07XX XXX XXX" inputMode="tel" value={phone} onChange={(e) => setPhone(maskUgPhoneInput(e.target.value))} />
      <button className="btn btn-primary" disabled={pending || !phone || bad}>Save</button>
      {msg && !msg.ok && <span role="alert" className="text-[13px] text-error">{msg.text}</span>}
    </form>
  );
}

export function ResolveFlagButton({ id }: { id: string }) {
  const { pending, msg, run } = useAct();
  return msg?.ok ? (
    <span className="text-[13px] text-ok">Checked ✓</span>
  ) : (
    <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => run(() => resolveFlagAction(id))}>
      Mark checked
    </button>
  );
}

export function UndoMergeButton({ id }: { id: string }) {
  const { pending, msg, run } = useAct();
  return (
    <span className="flex flex-col items-end">
      <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => run(() => undoMergeAction(id))}>Undo merge</button>
      {msg && !msg.ok && <span role="alert" className="text-[12px] text-error">{msg.text}</span>}
    </span>
  );
}

export function TargetForm({ percent, due }: { percent: number; due: string }) {
  const [p, setP] = useState(String(percent));
  const [d, setD] = useState(due);
  const { pending, msg, run } = useAct();
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => (e.preventDefault(), run(() => setTargetAction(Number(p), d)))}>
      <label className="text-[13px]">
        <span className="field-label">Target % complete</span>
        <input className="input w-24" inputMode="numeric" value={p} onChange={(e) => setP(e.target.value.replace(/\D/g, "").slice(0, 3))} />
      </label>
      <label className="text-[13px]">
        <span className="field-label">By</span>
        <input className="input" type="date" value={d} onChange={(e) => setD(e.target.value)} />
      </label>
      <button className="btn btn-secondary" disabled={pending}>Set target</button>
      {msg && !msg.ok && <span role="alert" className="text-[13px] text-error">{msg.text}</span>}
    </form>
  );
}
