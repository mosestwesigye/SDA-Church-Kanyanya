"use client";

import { useEffect, useRef } from "react";

/** Accessible modal built on <dialog> (focus trap + Esc handled by the browser). */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={`m-auto w-[calc(100%-32px)] ${wide ? "max-w-3xl" : "max-w-md"} rounded-[10px] border border-line bg-surface p-0 text-ink backdrop:bg-black/40`}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="min-h-[44px] min-w-[44px] text-ink-2" aria-label="Close">
          ✕
        </button>
      </div>
      <div className="px-5 py-4 max-h-[70dvh] overflow-y-auto">{children}</div>
      {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
    </dialog>
  );
}
