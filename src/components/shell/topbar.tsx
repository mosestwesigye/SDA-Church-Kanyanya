import Link from "next/link";
import { OnlineStatus } from "./online-status";

/** Desktop top bar from the design: member search, sync state, primary action. */
export function TopBar({ showAdd = false }: { showAdd?: boolean }) {
  return (
    <header className="sticky top-0 z-10 flex h-16 print:hidden items-center gap-4 border-b border-line bg-surface px-4 md:px-7">
      <form action="/members" role="search" className="flex-1 max-w-[460px]">
        <label htmlFor="global-search" className="sr-only">Search members</label>
        <input
          id="global-search"
          name="q"
          type="search"
          placeholder="Search members by name, ID or phone"
          className="w-full h-10 rounded-[6px] border border-line bg-bg px-3 text-[14px] placeholder:text-ink-3"
        />
      </form>
      <OnlineStatus />
      {showAdd && (
        <Link href="/members/new" className="btn btn-primary hidden md:inline-flex">
          Add member
        </Link>
      )}
    </header>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-[24px] md:text-[28px] font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="text-ink-2 mt-1">{subtitle}</p>}
      </div>
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}
