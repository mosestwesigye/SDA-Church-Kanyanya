import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata = { title: "Admin" };

export default function Page() {
  return <ComingSoon title="Admin" phase={8} need={["admin.users", "manage"]} />;
}
