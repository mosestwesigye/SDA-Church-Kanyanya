"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export type RunResult = { ok: boolean; message?: string; error?: string };

/** Run a server action from a client widget, show its message and refresh the page on success. */
export function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<RunResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error ?? "Failed." });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });
  return { pending, msg, run, setMsg };
}

export function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  return msg ? <p role={msg.ok ? "status" : "alert"} className={`text-[13px] ${msg.ok ? "text-ok" : "text-error"}`}>{msg.text}</p> : null;
}
