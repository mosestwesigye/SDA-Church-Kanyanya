import Image from "next/image";
import Link from "next/link";
import { BottomNav, SidebarLinks, type LinkItem } from "@/components/shell/sidebar-links";
import { NAV } from "@/components/shell/nav";
import { ROLE_LABELS } from "@/server/authz/catalog";
import { can, memberScopeWhere } from "@/server/authz/policy";
import { requireContext } from "@/server/auth/session";
import { db } from "@/server/db";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
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
    items: s.items.map<LinkItem>((i) => ({ href: i.href, label: i.label, count: i.countKey ? counts[i.countKey] : undefined })),
  }));
  const mobile: LinkItem[] = visible.flatMap((s) => s.items.filter((i) => i.mobile)).map((i) => ({ href: i.href, label: i.label === "Data clean-up" ? "Clean-up" : i.label === "Dashboard" ? "Home" : i.label }));
  mobile.push({ href: "/account", label: "More" });

  const roleLabel = ctx.roles.map((r) => ROLE_LABELS[r]).join(", ") || "No role";

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      <aside className="hidden md:flex md:flex-col sticky top-0 h-dvh bg-sidebar text-sidebar-ink">
        <Link href="/dashboard" className="flex items-center gap-2.5 px-5 pt-6 pb-4">
          <Image src="/sda-logo.png" alt="Seventh-day Adventist Church" width={42} height={44} priority />
          <span>
            <span className="block text-[16px] font-semibold leading-[1.2]">SDAK Church Manager</span>
            <span className="block text-[12px] text-sidebar-muted whitespace-nowrap">SDA Church Kanyanya · CUC</span>
          </span>
        </Link>
        <SidebarLinks sections={sections} />
        <div className="border-t border-white/10 mx-[14px] py-4 flex items-center gap-3">
          <span aria-hidden className="grid place-items-center size-9 rounded-full bg-white/15 text-[13px] font-semibold">{initials(ctx.label)}</span>
          <Link href="/account" className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold truncate">{ctx.label}</span>
            <span className="block text-[12px] text-sidebar-muted truncate">
              {roleLabel} · {ctx.twoFactorEnabled ? "2FA on" : "2FA off"}
            </span>
          </Link>
        </div>
      </aside>

      <div className="min-w-0 pb-[72px] md:pb-0">{children}</div>
      <BottomNav items={mobile} />
    </div>
  );
}
