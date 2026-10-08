import { meetingDayShort } from "@/lib/minutes-format";

export function MinutesStatus({ status, approvedOn }: { status: "DRAFT" | "APPROVED"; approvedOn?: Date | null }) {
  return status === "APPROVED" ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--ok)_14%,transparent)] px-2.5 py-0.5 text-[12px] font-semibold text-ok" title={approvedOn ? `Approved ${meetingDayShort(approvedOn)}` : undefined}>
      <span aria-hidden className="size-1.5 rounded-full bg-ok" /> Approved
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--status-irregular)_16%,transparent)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--status-irregular)]">
      <span aria-hidden className="size-1.5 rounded-full bg-[var(--status-irregular)]" /> Awaiting approval
    </span>
  );
}
