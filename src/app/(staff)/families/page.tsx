import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata = { title: "Families" };

export default function Page() {
  return <ComingSoon title="Families" phase={6} need={["household", "read"]} />;
}
