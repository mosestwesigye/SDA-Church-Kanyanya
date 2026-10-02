import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata = { title: "Transfers & status" };

export default function Page() {
  return <ComingSoon title="Transfers & status" phase={5} need={["transfer", "read"]} />;
}
