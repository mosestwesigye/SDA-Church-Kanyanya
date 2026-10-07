"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { cancelCorrectionAction, submitCorrectionAction } from "@/app/(member)/me/actions";
import { Msg, useRun } from "@/components/ui/use-run";
import { maskUgPhoneInput } from "@/lib/phone";
import { toast } from "@/lib/toast";

export function CancelCorrection({ id }: { id: string }) {
  const { pending, msg, run } = useRun();
  return (
    <span className="mt-1 inline-flex flex-col">
      <button type="button" className="min-h-[44px] text-left text-[14px] text-error" disabled={pending} onClick={() => run(() => cancelCorrectionAction(id))}>Cancel this request</button>
      <Msg msg={msg} />
    </span>
  );
}

type Opt = { id: string; label: string };
type Values = Record<string, string>;

export function CorrectionForm({ initial, zones, professions }: { initial: Values; zones: Opt[]; professions: Opt[] }) {
  const [v, setV] = useState<Values>(initial);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<{ error: string; fieldErrors?: Record<string, string> } | null>(null);
  const changed = Object.keys(v).filter((k) => v[k] !== initial[k]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV({ ...v, [k]: k === "phone" || k === "nextOfKinPhone" ? maskUgPhoneInput(e.target.value) : e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const patch: Record<string, unknown> = Object.fromEntries(changed.map((k) => [k, k === "yearJoined" ? (v[k] ? Number(v[k]) : null) : v[k]]));
    start(async () => {
      const r = await submitCorrectionAction({ ...patch, note });
      if (r && !r.ok) {
        setErr({ error: r.error, fieldErrors: r.fieldErrors });
        toast.error(r.error);
      }
    });
  };
  const field = (k: string, label: string, input: React.ReactNode, hint?: string) => (
    <div>
      <label htmlFor={`c-${k}`} className="field-label">
        {label}
        {v[k] !== initial[k] && <span className="ml-2 rounded bg-primary-soft px-1.5 py-0.5 text-[11px] font-semibold text-primary">Changed</span>}
      </label>
      {input}
      {err?.fieldErrors?.[k] ? <p className="mt-1 text-[13px] text-error">{err.fieldErrors[k]}</p> : hint ? <p className="mt-1 text-[13px] text-ink-2">{hint}</p> : null}
    </div>
  );
  const text = (k: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={`c-${k}`} className="input" value={v[k] ?? ""} onChange={set(k)} aria-invalid={Boolean(err?.fieldErrors?.[k])} {...extra} />
  );
  const select = (k: string, opts: Opt[]) => (
    <select id={`c-${k}`} className="input" value={v[k] ?? ""} onChange={set(k)}>
      <option value="">Not recorded</option>
      {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="card grid gap-4 p-5 sm:grid-cols-2">
        {field("firstName", "First name", text("firstName", { required: true, maxLength: 80 }))}
        {field("lastName", "Last name", text("lastName", { required: true, maxLength: 80 }))}
        {field("gender", "Gender", select("gender", [{ id: "FEMALE", label: "Female" }, { id: "MALE", label: "Male" }]))}
        {field("dobDate", "Date of birth", text("dobDate", { type: "date", max: new Date().toISOString().slice(0, 10) }))}
        {field("phone", "Phone", text("phone", { inputMode: "tel", placeholder: "07XX XXX XXX" }), "Changing this changes the number you sign in with.")}
        {field("email", "Email", text("email", { type: "email", maxLength: 120 }))}
        {field("zoneId", "Zone", select("zoneId", zones))}
        {field("professionId", "Profession", select("professionId", professions))}
        {field("maritalStatus", "Marital status", select("maritalStatus", [
          { id: "SINGLE", label: "Single" }, { id: "MARRIED", label: "Married" }, { id: "SEPARATED", label: "Separated" }, { id: "COHABITING", label: "Cohabiting" }, { id: "WIDOWED", label: "Widowed" },
        ]))}
        {field("yearJoined", "Year joined this church", text("yearJoined", { inputMode: "numeric", pattern: "[0-9]{4}", maxLength: 4 }))}
        {field("nextOfKinName", "Next of kin", text("nextOfKinName", { maxLength: 120 }))}
        {field("nextOfKinPhone", "Next of kin phone", text("nextOfKinPhone", { inputMode: "tel", placeholder: "07XX XXX XXX" }))}
      </div>
      <div>
        <label htmlFor="c-note" className="field-label">Anything the clerk should know? (optional)</label>
        <textarea id="c-note" className="input min-h-[88px] py-2" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </div>
      {err && <p role="alert" className="rounded-[6px] bg-error-soft px-3 py-2 text-sm text-error">{err.error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={pending || changed.length === 0}>{pending ? "Sending…" : `Send ${changed.length || ""} change${changed.length === 1 ? "" : "s"} to the clerk`}</button>
        <Link href="/me" className="btn btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}
