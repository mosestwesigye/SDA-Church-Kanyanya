/**
 * Tiny toast store shared by every client component. `<Toaster />` (root layout) renders it.
 * Server actions that redirect use `flash()` from `@/server/flash` instead; the Toaster picks that up after navigation.
 */

export type ToastKind = "success" | "error" | "info" | "warning";
export type Toast = { id: number; kind: ToastKind; title: string; description?: string; duration: number };
export type ToastOptions = { description?: string; duration?: number; id?: number };

export const FLASH_COOKIE = "sdak_flash";

let seq = 0;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function subscribeToasts(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export const getToasts = () => toasts;
const EMPTY: Toast[] = [];
export const getServerToasts = () => EMPTY;

function push(kind: ToastKind, title: string, opts: ToastOptions = {}) {
  const id = opts.id ?? ++seq;
  const t: Toast = { id, kind, title, description: opts.description, duration: opts.duration ?? (kind === "error" ? 8000 : 5000) };
  // Same text twice in a row (e.g. a double click) replaces rather than stacks.
  toasts = [...toasts.filter((x) => x.id !== id && !(x.title === title && x.description === t.description)), t].slice(-4);
  emit();
  return id;
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (title: string, opts?: ToastOptions) => push("success", title, opts),
  error: (title: string, opts?: ToastOptions) => push("error", title, opts),
  info: (title: string, opts?: ToastOptions) => push("info", title, opts),
  warning: (title: string, opts?: ToastOptions) => push("warning", title, opts),
  dismiss: dismissToast,
  /** Toast a server-action result: its message on success (or `success`), its error on failure. */
  result(r: { ok: boolean; message?: string; error?: string } | undefined | null, success = "Changes saved.") {
    if (!r) return;
    if (r.ok) push("success", r.message ?? success);
    else push("error", r.error ?? "Something went wrong. Please try again.");
  },
};
