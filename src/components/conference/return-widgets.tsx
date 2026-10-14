"use client";

import Link from "next/link";
import { useState } from "react";
import { dateReceivedAction, detailAction, markSentAction, reopenAction, setAttendanceAction, setFigureAction } from "@/app/(staff)/conference/actions";
import { Msg, useRun } from "@/components/ui/use-run";
import type { DetailRow, LineKey, Period } from "@/server/conference/service";

type Line = { key: LineKey; code: string; label: string; source: string; computed: number | null; value: number | null; override: { value: number; reason: string; by?: string } | null; drill: boolean };

const show = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-UG"));

/** One line of the return: the register figure, and the clerk's own figure with a reason. */
export function FigureRow({ period, line, editable }: { period: Period; line: Line; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(line.override ? String(line.override.value) : "");
  const [reason, setReason] = useState(line.override?.reason ?? "");
  const [detail, setDetail] = useState<DetailRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const { pending, msg, run } = useRun();

  const openDetail = async () => {
    if (detail) return setDetail(null);
    setLoading(true);
    try {
      setDetail(await detailAction(period, line.key));
    } finally {
      setLoading(false);
    }
  };

  return (
    <li className="py-3.5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <span className="mono w-9 shrink-0 pt-0.5 text-[13px] font-semibold text-primary">{line.code}</span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{line.label}</p>
          <p className="text-[12px] text-ink-3">
            {line.source}
            {line.computed !== null && line.override && <> · register figure {show(line.computed)}</>}
          </p>
          {line.override && (
            <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--status-irregular)_14%,transparent)] px-2.5 py-0.5 text-[12px] text-ink">
              <span className="font-semibold">Entered by the clerk:</span> {line.override.reason}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {line.drill && (line.computed ?? 0) > 0 && (
            <button type="button" onClick={openDetail} className="min-h-[36px] rounded-[6px] px-2 text-[13px] text-primary hover:underline" aria-expanded={Boolean(detail)}>
              {loading ? "Loading…" : detail ? "Hide members" : "Members"}
            </button>
          )}
          <span className={`min-w-[64px] text-right text-[22px] font-semibold tabular-nums ${line.override ? "text-[var(--status-irregular)]" : ""}`}>{show(line.value)}</span>
          {editable && !editing && (
            <button type="button" className="btn btn-secondary h-9 min-h-9 px-3 text-[13px]" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
      </div>

      {editing && (
        <form
          className="ml-[52px] mt-3 grid gap-2 rounded-[8px] border border-line bg-surface-2/60 p-3 sm:grid-cols-[120px_minmax(0,1fr)_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => setFigureAction(period, line.key, value, reason), () => setEditing(false));
          }}
        >
          <div>
            <label htmlFor={`v-${line.key}`} className="field-label">Figure</label>
            <input id={`v-${line.key}`} inputMode="numeric" className="input h-10" value={value} placeholder={line.computed === null ? "" : String(line.computed)} onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))} />
          </div>
          <div>
            <label htmlFor={`r-${line.key}`} className="field-label">Reason</label>
            <input id={`r-${line.key}`} className="input h-10" value={reason} maxLength={300} placeholder="e.g. Figure from the church book; 3 baptisms not yet entered" onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex items-end gap-2">
            <button className="btn btn-primary h-10 min-h-10" disabled={pending || (value !== "" && !reason.trim())}>{pending ? "Saving…" : "Save"}</button>
            {line.override && (
              <button type="button" className="btn btn-secondary h-10 min-h-10" disabled={pending} onClick={() => run(() => setFigureAction(period, line.key, "", ""), () => setEditing(false))}>
                Use register
              </button>
            )}
            <button type="button" className="h-10 px-2 text-[13px] text-ink-2 hover:underline" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          <p className="text-[12px] text-ink-3 sm:col-span-3">Leave the figure empty to use the register figure{line.computed !== null ? ` (${show(line.computed)})` : ""}.</p>
          <div className="sm:col-span-3"><Msg msg={msg} /></div>
        </form>
      )}

      {detail && (
        <div className="ml-[52px] mt-3 overflow-hidden rounded-[8px] border border-line">
          {detail.length === 0 ? (
            <p className="px-3 py-2.5 text-[13px] text-ink-2">No members found.</p>
          ) : (
            <table className="w-full text-[13px]">
              <tbody>
                {detail.map((d, i) => (
                  <tr key={`${d.id}-${i}`} className="border-t border-line first:border-t-0">
                    <td className="mono whitespace-nowrap px-3 py-2 text-ink-3">{d.memberId}</td>
                    <td className="px-3 py-2"><Link href={`/members/${d.id}`} className="font-medium hover:underline">{d.name}</Link></td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-2">{d.date}</td>
                    <td className="px-3 py-2 text-ink-2">{d.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </li>
  );
}

/** Head count for one Sabbath. */
export function AttendanceRow({ sabbath, label, n, count, editable, reported, upcoming: future }: { sabbath: string; label: string; n: number; count: number | null; editable: boolean; reported: boolean; upcoming: boolean }) {
  const [value, setValue] = useState(count === null ? "" : String(count));
  const { pending, msg, run } = useRun();
  const dirty = value !== (count === null ? "" : String(count));
  return (
    <li className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${reported ? "bg-primary-soft/40" : ""}`}>
      <span className="w-20 text-[13px] text-ink-3">Sabbath {n}</span>
      <span className="min-w-[120px] flex-1 text-[14px]">
        {label}
        {reported && <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-ink">Line {n === 7 ? "3a" : "3b"}</span>}
      </span>
      {editable && !future ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => setAttendanceAction(sabbath, value));
          }}
        >
          <label className="sr-only" htmlFor={`a-${sabbath}`}>Head count for {label}</label>
          <input id={`a-${sabbath}`} inputMode="numeric" className="input h-9 w-24 text-right" value={value} placeholder="—" onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))} />
          <button className="btn btn-secondary h-9 min-h-9 px-3 text-[13px]" disabled={pending || !dirty}>{pending ? "…" : "Save"}</button>
        </form>
      ) : (
        <span className="w-24 text-right font-semibold tabular-nums">{future ? <span className="text-[12px] font-normal text-ink-3">Upcoming</span> : show(count)}</span>
      )}
      {msg && <div className="w-full"><Msg msg={msg} /></div>}
    </li>
  );
}

/** Mark as sent (locks the figures), date received, reopen for correction. */
export function SendPanel({ period, state, pastorName, dateSent, dateReceived, canManage, blocked }: { period: Period; state: "DRAFT" | "SENT"; pastorName: string | null; dateSent: string | null; dateReceived: string | null; canManage: boolean; blocked: boolean }) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Kampala" });
  const [sent, setSent] = useState(today);
  const [pastor, setPastor] = useState(pastorName ?? "");
  const [received, setReceived] = useState(dateReceived ?? "");
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState("");
  const { pending, msg, run } = useRun();

  if (!canManage) return null;
  if (state === "SENT") {
    return (
      <div className="space-y-4">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => (e.preventDefault(), run(() => dateReceivedAction(period, received)))}>
          <div>
            <label htmlFor="rcv" className="field-label">Date received by the Conference</label>
            <input id="rcv" type="date" className="input h-10" value={received} max={today} onChange={(e) => setReceived(e.target.value)} />
          </div>
          <button className="btn btn-secondary h-10 min-h-10" disabled={pending || received === (dateReceived ?? "")}>Save</button>
        </form>
        {reopening ? (
          <form className="space-y-2" onSubmit={(e) => (e.preventDefault(), run(() => reopenAction(period, reason), () => setReopening(false)))}>
            <label htmlFor="why" className="field-label">Why does the return need correcting?</label>
            <input id="why" className="input h-10" value={reason} maxLength={250} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Conference asked us to correct the baptisms figure" />
            <div className="flex gap-2">
              <button className="btn btn-danger h-10 min-h-10" disabled={pending || !reason.trim()}>Reopen return</button>
              <button type="button" className="btn btn-secondary h-10 min-h-10" onClick={() => setReopening(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <button type="button" className="text-[14px] text-ink-2 underline hover:text-ink" onClick={() => setReopening(true)}>Reopen to correct a figure</button>
        )}
        <Msg msg={msg} />
        {dateSent && <p className="sr-only">Sent {dateSent}</p>}
      </div>
    );
  }
  return (
    <form className="space-y-3" onSubmit={(e) => (e.preventDefault(), run(() => markSentAction(period, sent, pastor)))}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="sent" className="field-label">Date sent</label>
          <input id="sent" type="date" className="input h-10" value={sent} max={today} onChange={(e) => setSent(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="pastor" className="field-label">Submitted by Pastor</label>
          <input id="pastor" className="input h-10" value={pastor} onChange={(e) => setPastor(e.target.value)} required minLength={2} />
        </div>
      </div>
      <button className="btn btn-primary" disabled={pending || blocked}>{pending ? "Saving…" : "Mark as sent"}</button>
      <p className="text-[12px] text-ink-3">Marking as sent locks the figures. The closing membership becomes next quarter’s opening figure.</p>
      <Msg msg={msg} />
    </form>
  );
}
