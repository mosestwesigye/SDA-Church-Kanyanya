import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata = { title: "Import" };

export default function Page() {
  return <ComingSoon title="Import" phase={4} need={["import", "run"]} />;
}
