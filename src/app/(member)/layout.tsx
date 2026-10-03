import Image from "next/image";
import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { SignOutButton } from "@/components/shell/sign-out";

/** Minimal shell for member self-service (phone sign-in). */
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const staff = ctx.roles.some((r) => r !== "MEMBER");
  return (
    <div className="min-h-dvh">
      <header className="bg-sidebar text-sidebar-ink print:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link href="/me" className="flex flex-1 items-center gap-2.5">
            <Image src="/sda-logo.png" alt="" width={32} height={34} priority />
            <span>
              <span className="block text-[15px] font-semibold leading-tight">SDA Church Kanyanya</span>
              <span className="block text-[12px] text-sidebar-muted">My membership record</span>
            </span>
          </Link>
          {staff && <Link href="/dashboard" className="min-h-[44px] content-center px-2 text-[14px] text-sidebar-muted">Staff view</Link>}
          <SignOutButton className="min-h-[44px] rounded-[6px] border border-white/25 px-3 text-[14px]" />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
