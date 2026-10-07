"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/lib/toast";

export type RunResult = { ok: boolean; message?: string; error?: string };

/** Run a server action from a client widget: toast the outcome, keep errors inline and refresh the page on success. */
export function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<RunResult>, after?: () => void, success?: string) =>
    start(async () => {
      let r: RunResult;
      try {
        r = await fn();
      } catch {
        r = { ok: false, error: "Couldn’t reach the server. Check your connection and try again." };
      }
      toast.result(r, success);
      setMsg(r.ok ? null : { ok: false, text: r.error ?? "Failed." });
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
