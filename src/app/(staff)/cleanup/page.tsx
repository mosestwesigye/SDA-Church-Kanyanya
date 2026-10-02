import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata = { title: "Data clean-up" };

export default function Page() {
  return <ComingSoon title="Data clean-up" phase={3} need={["cleanup", "use"]} />;
}
