import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata = { title: "Members" };

export default function Page() {
  return <ComingSoon title="Members" phase={2} need={["member", "read"]} />;
}
