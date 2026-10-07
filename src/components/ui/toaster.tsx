"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { dismissToast, FLASH_COOKIE, getServerToasts, getToasts, subscribeToasts, toast, type Toast, type ToastKind } from "@/lib/toast";

const STYLE: Record<ToastKind, { bar: string; icon: string; label: string; path: React.ReactNode }> = {
  success: { bar: "bg-ok", icon: "text-ok", label: "Success", path: <path d="m7.5 12.5 3 3 6-6.5" /> },
  error: { bar: "bg-error", icon: "text-error", label: "Error", path: <path d="M12 7.5v5.5M12 16.5v.01" /> },
  warning: { bar: "bg-[var(--status-irregular)]", icon: "text-[var(--status-irregular)]", label: "Warning", path: <path d="M12 7.5v5.5M12 16.5v.01" /> },
  info: { bar: "bg-primary", icon: "text-primary", label: "Notice", path: <path d="M12 11v5.5M12 7.5v.01" /> },
};

function ToastItem({ t }: { t: Toast }) {
  const [paused, setPaused] = useState(false);
  const left = useRef(t.duration);
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(() => dismissToast(t.id), left.current);
    return () => {
      clearTimeout(timer);
      left.current -= Date.now() - started;
    };
  }, [paused, t.id]);
  const s = STYLE[t.kind];
  return (
    <li
      role={t.kind === "error" ? "alert" : "status"}
      aria-live={t.kind === "error" ? "assertive" : "polite"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="toast-in pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-[10px] border border-line bg-surface py-3 pl-4 pr-2 text-ink shadow-[0_12px_32px_-12px_rgba(12,29,33,0.35),0_2px_6px_rgba(12,29,33,0.08)]"
    >
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${s.bar}`} />
      <svg aria-hidden viewBox="0 0 24 24" className={`mt-0.5 size-5 shrink-0 ${s.icon}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9.25" />
        {s.path}
      </svg>
      <div className="min-w-0 flex-1">
        <span className="sr-only">{s.label}: </span>
        <p className="text-[14px] font-semibold leading-snug">{t.title}</p>
        {t.description && <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{t.description}</p>}
      </div>
      <button type="button" onClick={() => dismissToast(t.id)} className="-my-1 grid size-9 shrink-0 place-items-center rounded-[6px] text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Dismiss notification">
        <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </li>
  );
}

/** Shows a toast queued by a server action (`flash()`) on the page it redirected to. */
function FlashReader() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    const raw = document.cookie.split("; ").find((c) => c.startsWith(`${FLASH_COOKIE}=`));
    if (!raw) return;
    document.cookie = `${FLASH_COOKIE}=; Max-Age=0; path=/`;
    try {
      const f = JSON.parse(decodeURIComponent(raw.slice(FLASH_COOKIE.length + 1))) as { kind?: ToastKind; title?: string; description?: string };
      if (f.title && f.kind && f.kind in STYLE) toast[f.kind](f.title, { description: f.description });
    } catch {
      // Ignore a malformed cookie.
    }
  }, [pathname, search]);
  return null;
}

/** Connection changes are announced everywhere, signed in or not. */
function ConnectionToasts() {
  useEffect(() => {
    const off = () => toast.warning("You’re offline", { description: "You can keep viewing saved pages. Edits to existing members are kept on this device and sent when you reconnect." });
    const on = () => toast.success("Back online", { description: "Your connection is restored." });
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => {
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
    };
  }, []);
  return null;
}

export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, getServerToasts);
  return (
    <>
      <Suspense fallback={null}>
        <FlashReader />
      </Suspense>
      <ConnectionToasts />
      <section aria-label="Notifications" className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center p-3 sm:inset-x-auto sm:bottom-0 sm:right-0 sm:top-auto sm:p-5 print:hidden">
        <ol className="flex w-full max-w-[400px] flex-col gap-2 sm:w-[380px]">
          {items.map((t) => (
            <ToastItem key={t.id} t={t} />
          ))}
        </ol>
      </section>
    </>
  );
}
