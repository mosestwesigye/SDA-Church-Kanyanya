import { AdminTabs } from "@/components/admin/admin-tabs";
import { TopBar } from "@/components/shell/topbar";
import { requireContext } from "@/server/auth/session";
import { adminTabs } from "./tabs";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const tabs = adminTabs(ctx);
  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7">
        <h1 className="mb-4 text-[24px] font-semibold leading-tight md:text-[28px]">Admin</h1>
        {tabs.length > 1 && <AdminTabs tabs={tabs} />}
        {children}
      </main>
    </>
  );
}
