"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "./nav-icons";

export type LinkItem = { href: string; label: string; icon: string; count?: number; attention?: boolean };

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

export function SidebarLinks({ sections }: { sections: { section: string; items: LinkItem[] }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-4">
      {sections.map((s) => (
        <div key={s.section} className="mt-5 first:mt-3">
          <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-sidebar-muted/80">{s.section}</div>
          <ul className="space-y-0.5">
            {s.items.map((item) => {
              const active = isActive(pathname, item.href);
              const showCount = item.count !== undefined && item.count > 0;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex h-10 items-center gap-3 rounded-[8px] px-3 text-[14px] transition-colors ${
                      active ? "bg-white/[0.12] font-semibold text-white" : "font-medium text-sidebar-ink/80 hover:bg-white/[0.06] hover:text-white"
                    }`}
                  >
                    {active && <span aria-hidden className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r-full bg-[#9fd6de]" />}
                    <NavIcon name={item.icon} className={`size-[18px] ${active ? "text-[#9fd6de]" : "text-sidebar-muted group-hover:text-white"}`} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {showCount &&
                      (item.attention ? (
                        <span className="min-w-[22px] rounded-full bg-[#e9b44c] px-1.5 py-px text-center text-[11px] font-semibold text-[#2b1d00] tabular-nums">
                          {item.count!.toLocaleString("en-UG")}
                          <span className="sr-only"> waiting</span>
                        </span>
                      ) : (
                        <span className="text-[12px] text-sidebar-muted tabular-nums">{item.count!.toLocaleString("en-UG")}</span>
                      ))}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function BottomNav({ items }: { items: LinkItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="md:hidden print:hidden fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-[58px] flex-col items-center justify-center gap-1 text-[12px] ${active ? "font-semibold text-primary" : "text-ink-2"}`}
              >
                {active && <span aria-hidden className="absolute top-0 h-[3px] w-8 rounded-b bg-primary" />}
                <span className="relative">
                  <NavIcon name={item.icon} className="size-[22px]" />
                  {item.attention && item.count ? <span className="absolute -right-1.5 -top-1 size-2.5 rounded-full border-2 border-surface bg-[#d9952b]" aria-label={`${item.count} waiting`} /> : null}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
