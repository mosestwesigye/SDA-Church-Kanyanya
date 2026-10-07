"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Dialog } from "@/components/ui/dialog";
import { listOutbox, onOutboxChange, removeOutboxItem, syncOutbox as syncItems, type OutboxItem } from "@/lib/outbox";
import { toast } from "@/lib/toast";

/** Send queued edits and say what happened. */
async function syncOutbox() {
  const r = await syncItems();
  if (r.sent) toast.success(`${r.sent} offline change${r.sent === 1 ? "" : "s"} saved`, { description: "Edits made on this device have reached the register." });
  if (r.problems) toast.error(`${r.problems} offline change${r.problems === 1 ? "" : "s"} couldn’t be saved`, { description: "Open the connection status in the top bar to review them." });
  return r;
}

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** Connection indicator in the top bar, with the offline outbox (edits waiting to sync). */
export function OnlineStatus() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [open, setOpen] = useState(false);
  const refresh = useCallback(() => {
    listOutbox().then(setItems, () => setItems([]));
  }, []);

  useEffect(() => {
    refresh();
    const off = onOutboxChange(refresh);
    const sync = () => syncOutbox().then(refresh);
    if (navigator.onLine) sync();
    window.addEventListener("online", sync);
    return () => {
      off();
      window.removeEventListener("online", sync);
    };
  }, [refresh]);

  const pending = items.filter((i) => i.status === "pending").length;
  const problems = items.length - pending;
  const label = !online
    ? pending ? `Offline — ${pending} change${pending === 1 ? "" : "s"} waiting` : "Offline — showing saved data"
    : pending ? `Syncing ${pending} change${pending === 1 ? "" : "s"}…` : problems ? `${problems} change${problems === 1 ? "" : "s"} need${problems === 1 ? "s" : ""} attention` : "Online";
  const dot = problems ? "bg-error" : online ? "bg-ok" : "bg-[var(--status-irregular)]";

  return (
    <>
      {items.length > 0 ? (
        <button type="button" onClick={() => setOpen(true)} className="ml-auto flex min-h-[44px] items-center gap-2 text-[13px] text-ink-2 hover:text-ink" aria-haspopup="dialog">
          <span aria-hidden className={`size-2 rounded-full ${dot}`} />
          <span role="status">{label}</span>
        </button>
      ) : (
        <span role="status" className="ml-auto hidden items-center gap-2 text-[13px] text-ink-3 sm:flex">
          <span aria-hidden className={`size-2 rounded-full ${dot}`} />
          {label}
        </span>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Changes saved on this device">
        <p className="mb-3 text-[14px] text-ink-2">Edits made offline are sent automatically when you’re back online. If someone else changed the same member first, you’ll need to make the change again.</p>
        <ul className="divide-y divide-line">
          {items.map((i) => (
            <li key={i.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/members/${i.memberId}`} className="font-semibold hover:underline" onClick={() => setOpen(false)}>{i.label}</Link>
                <span className={`text-[12px] ${i.status === "pending" ? "text-ink-2" : "text-error"}`}>{i.status === "pending" ? "Waiting" : i.status === "conflict" ? "Conflict" : "Not saved"}</span>
              </div>
              <p className="text-[13px] text-ink-2">{Object.keys(i.patch).join(", ")} · {new Date(i.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>
              {i.error && <p className="text-[13px] text-error">{i.error}</p>}
              {i.status !== "pending" && (
                <button type="button" className="mt-1 min-h-[44px] text-[14px] text-error" onClick={() => removeOutboxItem(i.id)}>Discard this change</button>
              )}
            </li>
          ))}
        </ul>
        {online && pending > 0 && <button type="button" className="btn btn-secondary mt-3" onClick={() => syncOutbox()}>Retry now</button>}
      </Dialog>
    </>
  );
}
