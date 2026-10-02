import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata = { title: "Ministries" };

export default function Page() {
  return <ComingSoon title="Ministries" phase={6} need={["ministry", "read"]} />;
}
