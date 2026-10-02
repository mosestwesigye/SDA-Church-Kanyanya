import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata = { title: "Reports" };

export default function Page() {
  return <ComingSoon title="Reports" phase={7} need={["report", "read"]} />;
}
