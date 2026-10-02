"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { advanceTransferAction, cancelRequestAction, createRequestAction, decideAction } from "@/app/(staff)/transfers/actions";
import { searchMembersAction } from "@/app/(staff)/members/form-actions";
import { STATUS_KEYS, STATUS_META } from "@/lib/labels";

type R = { ok: boolean; message?: string; error?: string; fieldErrors?: Record<string, string> };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<R>, after?: (r: R) => void) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "Done.") : (r.error ?? "Failed.") });
      if (r.ok) {
        after?.(r);
        router.refresh();
      }
    });
  return { pending, msg, run };
}

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  return msg ? <p role={msg.ok ? "status" : "alert"} className={`text-[13px] ${msg.ok ? "text-ok" : "text-error"}`}>{msg.text}</p> : null;
}

const TYPES = [
  { id: "TRANSFER_OUT", label: "Transfer out", help: "Member is moving to another church. Status becomes Self Transferred when approved." },
  { id: "TRANSFER_IN", label: "Transfer in", help: "Member’s letter is coming from another church. Status becomes Active when approved." },
  { id: "DEATH", label: "Record a death", help: "Status becomes Deceased when approved." },
  { id: "DISCIPLINE", label: "Discipline", help: "Status becomes Under Discipline. Visible only to Clerk, Pastor and Elders." },
  { id: "RESTORATION", label: "Restoration", help: "Returns the member to Active." },
  { id: "STATUS_UPDATE", label: "Other status change", help: "For example Active → Irregular, or Left the Faith." },
];

export function NewRequestForm({ member }: { member: { id: string; label: string; status: string | null } | null }) {
  const router = useRouter();
  const [picked, setPicked] = useState(member);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; memberId: string; lastName: string; firstName: string }[]>([]);
  const [type, setType] = useState("TRANSFER_OUT");
  const { pending, msg, run } = useRun();
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => searchMembersAction(q).then(setResults), 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        run(() => createRequestAction(fd), (r) => (setErrors({}), router.push(`/transfers?created=${(r as { data?: { id: string } }).data?.id ?? ""}`)));
        setErrors({});
      }}
    >
      <fieldset>
        <legend className="field-label">Member</legend>
        {picked ? (
          <div className="flex min-h-[44px] items-center justify-between rounded-[6px] border border-line px-3">
            <span>
              {picked.label} <span className="text-[13px] text-ink-2">· now {picked.status ? STATUS_META[picked.status as keyof typeof STATUS_META].label : "not recorded"}</span>
            </span>
            <button type="button" className="min-h-[44px] text-[14px] text-primary" onClick={() => setPicked(null)}>Change</button>
            <input type="hidden" name="memberId" value={picked.id} />
          </div>
        ) : (
          <>
            <input aria-label="Search members" className="input" placeholder="Name or SDAK/M ID" value={q} onChange={(e) => setQ(e.target.value)} />
            {results.length > 0 && q.trim().length >= 2 && (
              <ul className="mt-1 rounded-[6px] border border-line">
                {results.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="flex min-h-[44px] w-full items-center justify-between px-3 hover:bg-surface-2" onClick={() => setPicked({ id: r.id, label: `${r.lastName}, ${r.firstName} · ${r.memberId}`, status: null })}>
                      <span>{r.lastName}, {r.firstName}</span>
                      <span className="mono text-[12px] text-ink-3">{r.memberId}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </fieldset>

      <fieldset>
        <legend className="field-label">Request</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {TYPES.map((t) => (
            <label key={t.id} className={`flex cursor-pointer gap-3 rounded-[8px] border p-3 ${type === t.id ? "border-primary bg-primary-soft" : "border-line"}`}>
              <input type="radio" name="type" value={t.id} checked={type === t.id} onChange={() => setType(t.id)} className="mt-1 size-4" />
              <span>
                <span className="block font-semibold">{t.label}</span>
                <span className="block text-[13px] text-ink-2">{t.help}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {type === "STATUS_UPDATE" && (
        <div>
          <label htmlFor="toStatus" className="field-label">New status</label>
          <select id="toStatus" name="toStatus" className="input" required>
            <option value="">Choose…</option>
            {STATUS_KEYS.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
        </div>
      )}
      {(type === "TRANSFER_IN" || type === "TRANSFER_OUT") && (
        <div>
          <label htmlFor="otherChurch" className="field-label">{type === "TRANSFER_IN" ? "Coming from (church)" : "Moving to (church)"}</label>
          <input id="otherChurch" name="otherChurch" className="input" required placeholder="e.g. Ntinda SDA Church" />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="effectiveDate" className="field-label">Effective date</label>
          <input id="effectiveDate" name="effectiveDate" type="date" className="input" required defaultValue={new Date().toLocaleDateString("en-CA")} />
        </div>
        <div>
          <label htmlFor="file" className="field-label">Supporting document (optional)</label>
          <input id="file" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="input pt-2.5" />
        </div>
      </div>
      <div>
        <label htmlFor="reason" className="field-label">Reason</label>
        <textarea id="reason" name="reason" rows={3} className="input py-2" required minLength={5} placeholder="e.g. Board meeting of 14 Sep approved the transfer request." />
        {errors.reason && <p className="text-[13px] text-error">{errors.reason}</p>}
      </div>
      <Msg msg={msg} />
      <button className="btn btn-primary" disabled={pending || !picked}>{pending ? "Sending…" : "Send for approval"}</button>
    </form>
  );
}

export function DecisionButtons({ requestId, canApprove, canCancel, ownRequest }: { requestId: string; canApprove: boolean; canCancel: boolean; ownRequest: boolean }) {
  const [note, setNote] = useState("");
  const { pending, msg, run } = useRun();
  return (
    <div className="space-y-2">
      {canApprove && !ownRequest && (
        <>
          <label className="sr-only" htmlFor={`note-${requestId}`}>Decision note</label>
          <input id={`note-${requestId}`} className="input" placeholder="Note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => decideAction(requestId, true, note))}>Approve</button>
            <button type="button" className="btn btn-danger" disabled={pending || !note.trim()} onClick={() => run(() => decideAction(requestId, false, note))}>Reject</button>
          </div>
        </>
      )}
      {canApprove && ownRequest && <p className="text-[13px] text-ink-2">You made this request, so another approver must decide it.</p>}
      {canCancel && (
        <button type="button" className="text-[14px] text-error min-h-[44px]" disabled={pending} onClick={() => run(() => cancelRequestAction(requestId))}>Cancel request</button>
      )}
      <Msg msg={msg} />
    </div>
  );
}

export function TransferStageButtons({ transferId, direction, stage, letterDone, canUpdate }: { transferId: string; direction: "IN" | "OUT"; stage: string; letterDone: boolean; canUpdate: boolean }) {
  const { pending, msg, run } = useRun();
  if (!canUpdate || stage === "COMPLETED" || stage === "CANCELLED") return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {direction === "OUT" && !letterDone && (
        <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => run(() => advanceTransferAction(transferId, "LETTER_SENT", ""))}>Letter sent</button>
      )}
      {direction === "IN" && !letterDone && (
        <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => run(() => advanceTransferAction(transferId, "LETTER_RECEIVED", ""))}>Letter received</button>
      )}
      {stage === "BOARD_APPROVED" && letterDone && (
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => advanceTransferAction(transferId, "COMPLETED", ""))}>Mark completed</button>
      )}
      <Msg msg={msg} />
    </div>
  );
}
