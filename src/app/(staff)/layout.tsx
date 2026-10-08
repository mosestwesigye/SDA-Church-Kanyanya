import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BottomNav, SidebarLinks, type LinkItem } from "@/components/shell/sidebar-links";
import { NAV } from "@/components/shell/nav";
import { NavIcon } from "@/components/shell/nav-icons";
import { ROLE_LABELS } from "@/server/authz/catalog";
import { can, memberScopeWhere } from "@/server/authz/policy";
import { requireContext } from "@/server/auth/session";
import { db } from "@/server/db";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  // Members signed in by phone only have the self-service area.
  if (ctx.roles.length > 0 && ctx.roles.every((r) => r === "MEMBER")) redirect("/me");
  const canMembers = can(ctx, "member", "read");
  const [members, cleanup, approvals, ministries, corrections] = await Promise.all([
    canMembers ? db.member.count({ where: { AND: [memberScopeWhere(ctx), { deletedAt: null, mergedIntoId: null }] } }) : 0,
    can(ctx, "cleanup", "use") ? db.member.count({ where: { deletedAt: null, mergedIntoId: null, completeness: { lt: 100 } } }) : 0,
    can(ctx, "transfer", "read") ? db.statusChangeRequest.count({ where: { state: "PENDING" } }) : 0,
    db.listItem.count({ where: { type: "MINISTRY", active: true } }),
    can(ctx, "correction_request", "review") ? db.correctionRequest.count({ where: { state: "PENDING" } }) : 0,
  ]);
  const counts = { members, cleanup, approvals, ministries, corrections };

  const visible = NAV.map((s) => ({
    section: s.section,
    items: s.items.filter((i) => !i.need || can(ctx, i.need[0], i.need[1])),
  })).filter((s) => s.items.length > 0);
  const sections = visible.map((s) => ({
    section: s.section,
    items: s.items.map<LinkItem>((i) => ({ href: i.href, label: i.label, icon: i.icon, attention: i.attention, count: i.countKey ? counts[i.countKey] : undefined })),
  }));
  const mobile: LinkItem[] = visible
    .flatMap((s) => s.items.filter((i) => i.mobile))
    .map((i) => ({ href: i.href, icon: i.icon, attention: i.attention, count: i.countKey ? counts[i.countKey] : undefined, label: i.label === "Data clean-up" ? "Clean-up" : i.label === "Dashboard" ? "Home" : i.label }));
  mobile.push({ href: "/account", label: "More", icon: "more" });

  const roleLabel = ctx.roles.map((r) => ROLE_LABELS[r]).join(", ") || "No role";

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr] print:block">
      <aside className="hidden print:hidden md:flex md:flex-col sticky top-0 h-dvh bg-sidebar text-sidebar-ink">
        <Link href="/dashboard" className="mx-3 mt-4 flex items-center gap-2.5 rounded-[10px] px-2.5 py-3 hover:bg-white/[0.04]">
          <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-white/[0.08] ring-1 ring-white/10">
            <Image src="/sda-mark.png" alt="" width={21} height={23} priority />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-semibold leading-tight tracking-[-0.01em]">SDAK Church Manager</span>
            <span className="mt-0.5 block truncate text-[12px] text-sidebar-muted">SDA Church Kanyanya</span>
          </span>
          <span className="sr-only">Seventh-day Adventist Church, Central Uganda Conference — dashboard</span>
        </Link>
        <div aria-hidden className="mx-6 mt-3 border-t border-white/10" />
        <SidebarLinks sections={sections} />
        <div className="m-3 rounded-[10px] bg-white/[0.06] p-2.5 ring-1 ring-white/[0.08]">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-[#9fd6de] text-[13px] font-semibold text-sidebar">{initials(ctx.label)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{ctx.label}</span>
              <span className="block truncate text-[12px] text-sidebar-muted">{roleLabel}</span>
            </span>
            <Link href="/account" aria-label="Account settings" title="Account settings" className="grid size-9 shrink-0 place-items-center rounded-[8px] text-sidebar-muted hover:bg-white/10 hover:text-white">
              <NavIcon name="account" className="size-[18px]" />
            </Link>
          </div>
          {ctx.requires2fa && <Link href="/account" className="mt-2 flex items-center gap-2 rounded-[6px] px-1 text-[12px] text-sidebar-muted hover:text-white">
            <span aria-hidden className={`size-1.5 rounded-full ${ctx.twoFactorEnabled ? "bg-[#6fcf97]" : "bg-[#e9b44c]"}`} />
            {ctx.twoFactorEnabled ? "Two-step verification on" : "Two-step verification off — turn on"}
          </Link>}
        </div>
      </aside>

      <div className="min-w-0 pb-[72px] md:pb-0 print:pb-0">{children}</div>
      <BottomNav items={mobile} />
    </div>
  );
}
