import type { Resource } from "@/server/authz/catalog";

export type NavItem = {
  href: string;
  label: string;
  /** Permission needed to see the item. */
  need?: [Resource, string];
  countKey?: "members" | "cleanup" | "approvals" | "ministries" | "corrections";
  /** Counts that mean work is waiting are highlighted (and hidden at zero). */
  attention?: boolean;
  icon: string;
  mobile?: boolean;
};

export const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Records",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "dashboard", mobile: true },
      { href: "/members", label: "Members", icon: "members", need: ["member", "read"], countKey: "members", mobile: true },
      { href: "/families", label: "Families", icon: "families", need: ["household", "read"] },
      { href: "/cleanup", label: "Data clean-up", icon: "cleanup", need: ["cleanup", "use"], countKey: "cleanup", attention: true, mobile: true },
      { href: "/transfers", label: "Transfers & status", icon: "transfers", need: ["transfer", "read"], countKey: "approvals", attention: true },
      { href: "/ministries", label: "Ministries", icon: "ministries", need: ["ministry", "read"] },
    ],
  },
  {
    section: "Output",
    items: [
      { href: "/reports", label: "Reports", icon: "reports", need: ["report", "read"], mobile: true },
      { href: "/import", label: "Import", icon: "import", need: ["import", "run"] },
    ],
  },
  {
    section: "System",
    items: [
      { href: "/admin", label: "Admin", icon: "admin", need: ["admin.users", "manage"] },
      { href: "/self-service-requests", label: "Member requests", icon: "requests", need: ["correction_request", "review"], countKey: "corrections", attention: true },
    ],
  },
];
