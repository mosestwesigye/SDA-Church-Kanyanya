/**
 * Small, dependency-free charts for the dashboard (design 1a).
 * - Every mark has a hover/focus tooltip (CSS, no JS) and a legend or direct
 *   label, so identity is never colour alone.
 * - Each chart carries a visually-hidden table for screen readers.
 * - Status colours follow STATUS_BAR_ORDER (validated for adjacent contrast).
 */

export type Datum = { key: string; label: string; n: number; color: string };

const fmt = (n: number) => n.toLocaleString("en-UG");
const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

function SrTable({ caption, rows }: { caption: string; rows: { label: string; n: number }[] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Category</th>
          <th scope="col">Members</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th scope="row">{r.label}</th>
            <td>{r.n}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Tip({ text }: { text: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-[6px] bg-ink px-2 py-1 text-[12px] text-bg opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus:opacity-100"
    >
      {text}
    </span>
  );
}

/** One horizontal stacked bar (2px surface gaps between segments) + a two-column legend. */
export function StackedBar({ data, caption }: { data: Datum[]; caption: string }) {
  const total = data.reduce((s, d) => s + d.n, 0);
  const shown = data.filter((d) => d.n > 0);
  return (
    <figure>
      <div className="flex h-3.5 w-full gap-[2px]" aria-hidden>
        {shown.map((d, i) => (
          <span
            key={d.key}
            tabIndex={0}
            className={`group relative h-full min-w-[3px] outline-none focus-visible:ring-2 focus-visible:ring-accent ${i === 0 ? "rounded-l-[4px]" : ""} ${i === shown.length - 1 ? "rounded-r-[4px]" : ""}`}
            style={{ flexGrow: d.n, background: d.color }}
          >
            <Tip text={`${d.label}: ${fmt(d.n)} (${pct(d.n, total)}%)`} />
          </span>
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2 text-[15px]">
        {data.map((d) => (
          <div key={d.key} className="flex items-center gap-2.5">
            <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: d.color }} />
            <dt className="flex-1">{d.label}</dt>
            <dd className="font-semibold tabular-nums">{fmt(d.n)}</dd>
          </div>
        ))}
      </dl>
      <SrTable caption={caption} rows={data.map((d) => ({ label: d.label, n: d.n }))} />
    </figure>
  );
}

/** Donut with 2px gaps between arcs, legend with counts (gender). */
export function Donut({ data, caption, size = 104 }: { data: Datum[]; caption: string; size?: number }) {
  const total = data.reduce((s, d) => s + d.n, 0) || 1;
  const r = 40;
  const c = 2 * Math.PI * r;
  const gap = data.filter((d) => d.n > 0).length > 1 ? 2.5 : 0;
  const arcs = data
    .filter((d) => d.n > 0)
    .map((d, i, all) => ({ d, len: (d.n / total) * c, offset: all.slice(0, i).reduce((s, x) => s + (x.n / total) * c, 0) }));
  return (
    <figure className="flex items-center gap-6">
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className="shrink-0 -rotate-90">
        {arcs.map(({ d, len, offset }) => (
              <circle
                key={d.key}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth="16"
                strokeDasharray={`${Math.max(len - gap, 0.5)} ${c}`}
                strokeDashoffset={-offset}
              >
                <title>{`${d.label}: ${fmt(d.n)} (${pct(d.n, total)}%)`}</title>
              </circle>
        ))}
      </svg>
      <dl className="flex-1 space-y-2.5 text-[15px]">
        {data.map((d) => (
          <div key={d.key} className="flex items-center gap-2.5">
            <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: d.color }} />
            <dt className="flex-1">{d.label}</dt>
            <dd className="font-semibold tabular-nums">{fmt(d.n)}</dd>
          </div>
        ))}
      </dl>
      <SrTable caption={caption} rows={data.map((d) => ({ label: d.label, n: d.n }))} />
    </figure>
  );
}

/** Horizontal bar list: label, bar (rounded data end), value. One hue for magnitude. */
export function BarList({ data, caption, labelWidth = 104 }: { data: Datum[]; caption: string; labelWidth?: number }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  return (
    <figure>
      <ul className="space-y-2.5 text-[15px]">
        {data.map((d) => (
          <li key={d.key} className="grid items-center gap-3" style={{ gridTemplateColumns: `${labelWidth}px 1fr 40px` }}>
            <span className="truncate" title={d.label}>{d.label}</span>
            <span className="relative h-2.5 rounded-[4px] bg-surface-2" aria-hidden>
              <span
                tabIndex={0}
                className="group absolute inset-y-0 left-0 rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
                style={{ width: `${Math.max((d.n / max) * 100, d.n ? 2 : 0)}%`, background: d.color }}
              >
                <Tip text={`${d.label}: ${fmt(d.n)}`} />
              </span>
            </span>
            <span className="text-right font-semibold tabular-nums">{fmt(d.n)}</span>
          </li>
        ))}
      </ul>
      <SrTable caption={caption} rows={data.map((d) => ({ label: d.label, n: d.n }))} />
    </figure>
  );
}
