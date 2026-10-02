import type { Resource } from "@/server/authz/catalog";

export type NavItem = {
  href: string;
  label: string;
  /** Permission needed to see the item. */
  need?: [Resource, string];
  countKey?: "members" | "cleanup" | "approvals" | "ministries" | "corrections";
  mobile?: boolean;
};

export const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Records",
    items: [
      { href: "/dashboard", label: "Dashboard", mobile: true },
      { href: "/members", label: "Members", need: ["member", "read"], countKey: "members", mobile: true },
      { href: "/families", label: "Families", need: ["household", "read"] },
      { href: "/cleanup", label: "Data clean-up", need: ["cleanup", "use"], countKey: "cleanup", mobile: true },
      { href: "/transfers", label: "Transfers & status", need: ["transfer", "read"], countKey: "approvals" },
      { href: "/ministries", label: "Ministries", need: ["ministry", "read"], countKey: "ministries" },
    ],
  },
  {
    section: "Output",
    items: [
      { href: "/reports", label: "Reports", need: ["report", "read"], mobile: true },
      { href: "/import", label: "Import", need: ["import", "run"] },
    ],
  },
  {
    section: "System",
    items: [
      { href: "/admin", label: "Admin", need: ["admin.users", "manage"] },
      { href: "/self-service-requests", label: "Self-service requests", need: ["correction_request", "review"], countKey: "corrections" },
    ],
  },
];
