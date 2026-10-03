"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AdminTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Admin sections" className="-mx-4 mb-6 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
      <ul className="flex gap-1">
        {tabs.map((t) => {
          const active = path === t.href || path.startsWith(`${t.href}/`);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-[44px] items-center whitespace-nowrap border-b-2 px-3 text-[14px] ${active ? "border-primary font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
