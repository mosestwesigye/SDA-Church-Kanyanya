"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type LinkItem = { href: string; label: string; count?: number };

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

export function SidebarLinks({ sections }: { sections: { section: string; items: LinkItem[] }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-[14px]">
      {sections.map((s) => (
        <div key={s.section}>
          <div className="px-[10px] pt-4 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-muted">{s.section}</div>
          <ul>
            {s.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center justify-between min-h-[35px] px-[10px] rounded-[6px] text-[14px] text-sidebar-ink hover:bg-white/10 ${
                      active ? "bg-white/[0.12] font-semibold shadow-[inset_3px_0_0_var(--sidebar-ink)]" : ""
                    }`}
                  >
                    <span>{item.label}</span>
                    {item.count !== undefined && <span className="text-[12px] text-sidebar-muted tabular-nums">{item.count.toLocaleString("en-UG")}</span>}
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
    <nav aria-label="Main" className="md:hidden fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-[56px] items-center justify-center text-[13px] ${active ? "font-semibold text-primary" : "text-ink-2"}`}
              >
                {active && <span aria-hidden className="absolute top-0 h-[3px] w-8 rounded-b bg-primary" />}
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
