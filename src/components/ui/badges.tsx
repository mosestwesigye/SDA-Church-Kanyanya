import { NOT_RECORDED, STATUS_META, type StatusKey } from "@/lib/labels";

/** Status as a colour swatch plus a text label — never colour alone. */
export function StatusBadge({ status, size = "sm" }: { status: StatusKey | null | undefined; size?: "sm" | "md" }) {
  const meta = status ? STATUS_META[status] : NOT_RECORDED;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-surface whitespace-nowrap ${
        size === "md" ? "px-2.5 py-1 text-[14px] font-semibold" : "px-2 py-0.5 text-[13px]"
      }`}
    >
      <span aria-hidden className="size-2 rounded-[2px]" style={{ background: meta.color }} />
      {meta.label}
    </span>
  );
}

export function RestrictedTag() {
  return <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-ink-2 uppercase">Restricted</span>;
}

/** Completeness bar: red under 40%, teal under 80%, green above. */
export function CompletenessBar({ value, showLabel = true, className = "" }: { value: number; showLabel?: boolean; className?: string }) {
  const color = value < 40 ? "var(--error)" : value < 80 ? "var(--accent)" : "var(--ok)";
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <span
        className="h-1.5 flex-1 min-w-12 rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Profile completeness"
      >
        <span className="block h-full rounded-full" style={{ width: `${Math.max(value, 3)}%`, background: color }} />
      </span>
      {showLabel && <span className="w-9 text-right text-[13px] tabular-nums text-ink-2">{value}%</span>}
    </span>
  );
}

export function Avatar({ initials, size = 32 }: { initials: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-primary-soft text-primary font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </span>
  );
}
