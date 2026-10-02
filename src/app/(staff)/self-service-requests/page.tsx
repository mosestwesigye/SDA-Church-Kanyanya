import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata = { title: "Self-service requests" };

export default function Page() {
  return <ComingSoon title="Self-service requests" phase={8} need={["correction_request", "review"]} />;
}
