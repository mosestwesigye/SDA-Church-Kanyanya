import type { Metadata } from "next";
import Link from "next/link";
import { AddItem, ItemRow } from "@/components/admin/list-widgets";
import { EmptyState } from "@/components/ui/states";
import { LIST_TYPES, listItemsForAdmin } from "@/server/admin/lists";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Lists · Admin" };

export default async function ListsPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const ctx = await requirePermission("admin.lists", "manage");
  const { type: t } = await searchParams;
  const current = LIST_TYPES.find((l) => l.type === t) ?? LIST_TYPES[0]!;
  const items = await listItemsForAdmin(db, ctx, current.type);
  const noun = current.label.replace(/s$/, "").toLowerCase();
  return (
    <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="Lists">
        <ul className="flex gap-1 overflow-x-auto lg:flex-col">
          {LIST_TYPES.map((l) => (
            <li key={l.type}>
              <Link href={`/admin/lists?type=${l.type}`} aria-current={l.type === current.type ? "page" : undefined}
                className={`flex min-h-[44px] items-center whitespace-nowrap rounded-[6px] px-3 ${l.type === current.type ? "bg-primary-soft font-semibold text-primary" : "text-ink-2 hover:bg-surface-2"}`}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <section className="space-y-4">
        <div className="card p-4"><AddItem type={current.type} noun={noun} /></div>
        <p className="text-[14px] text-ink-2">Renaming changes the name everywhere it’s used. Hidden items stay on existing records but can’t be chosen for new ones. All changes are audited.</p>
        {items.length === 0 ? (
          <EmptyState title={`No ${current.label.toLowerCase()} yet`}>Add the first one above.</EmptyState>
        ) : (
          <ul className="card" aria-label={current.label}>
            {items.map((i) => <ItemRow key={i.id} {...i} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
