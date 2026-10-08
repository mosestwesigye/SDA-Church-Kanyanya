/** Presentation details for each report: category, icon, options and what it contains. */
export const REPORT_META: Record<string, { category: string; includes: string[]; icon: React.ReactNode }> = {
  quarterly: {
    category: "Conference",
    includes: ["Opening and closing membership", "Gains and losses by type", "Status changes in the quarter"],
    icon: <path d="M4 20V10m5.5 10V4M15 20v-7m5.5 7V8" />,
  },
  overview: {
    category: "Membership",
    includes: ["Status, gender and age with percentages", "Every zone and ministry", "Members joined in the last five years"],
    icon: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><path d="M14 17h6M17 14v6" /></>,
  },
  movements: {
    category: "Conference",
    includes: ["Any date range", "Baptisms, transfers, deaths and more", "Gains, losses and net change"],
    icon: <><path d="M4 8h14m0 0-3.5-3.5M18 8l-3.5 3.5" /><path d="M20 16H6m0 0 3.5-3.5M6 16l3.5 3.5" /></>,
  },
  "age-groups": {
    category: "Departments",
    includes: ["Adventurers, Pathfinders, Youth", "Adults and Senior citizens", "Age, gender and phone"],
    icon: <><circle cx="7" cy="7" r="2.5" /><circle cx="17" cy="9" r="2" /><path d="M3 19c.4-3 2-5 4-5s3.6 2 4 5M13.5 19c.3-2.3 1.6-4 3.5-4s3.2 1.7 3.5 4" /></>,
  },
  status: {
    category: "Membership",
    includes: ["Counts per status", "Member list under each status", "Filter by zone"],
    icon: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5V12l6 6" /></>,
  },
  "ministry-roster": {
    category: "Ministries",
    includes: ["Members of one ministry", "Their roles", "Phone contacts"],
    icon: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.2 2.5 3.5 5.2" /></>,
  },
  zones: {
    category: "Visitation",
    includes: ["Members grouped by zone", "Status and phone", "One zone or all"],
    icon: <><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  },
  families: {
    category: "Families / cells",
    includes: ["Every family and cell", "Head or cell leader first", "Contacts and zone"],
    icon: <><path d="M3.5 10.5 12 4l8.5 6.5" /><path d="M5.5 9v11h13V9" /><path d="M10 20v-5.5h4V20" /></>,
  },
  birthdays: {
    category: "Pastoral care",
    includes: ["Birthdays in a month", "Sorted by day", "Age they turn"],
    icon: <><path d="M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7M5 16.5c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0" /><path d="M12 12V8m0-4.5c.8.9 1.2 1.7 0 2.5-1.2-.8-.8-1.6 0-2.5Z" /></>,
  },
  "data-quality": {
    category: "Data quality",
    includes: ["How complete records are", "Most often missing details", "Least complete records first"],
    icon: <><path d="m14.5 4.5 5 5L9 20H4v-5L14.5 4.5Z" /><path d="m12.5 6.5 5 5" /></>,
  },
  minutes: {
    category: "Governance",
    includes: ["References and meeting dates", "Approval status", "Meetings without a file"],
    icon: <><path d="M7 3h7.5L19 7.5V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v5h5M9.5 12h6M9.5 15.5h6M9.5 8.5h2" /></>,
  },
};

export function ReportIcon({ reportKey, className = "size-5" }: { reportKey: string; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {REPORT_META[reportKey]?.icon}
    </svg>
  );
}

export function FormatChips() {
  return (
    <span className="flex gap-1.5">
      {["PDF", "Excel", "Print"].map((f) => (
        <span key={f} className="rounded-[4px] border border-line px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">{f}</span>
      ))}
    </span>
  );
}
