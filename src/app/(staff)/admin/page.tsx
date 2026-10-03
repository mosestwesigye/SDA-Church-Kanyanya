import { redirect } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { adminTabs } from "./tabs";

export default async function AdminPage() {
  const ctx = await requireContext();
  const first = adminTabs(ctx)[0];
  redirect(first ? first.href : "/denied?need=admin.users:manage");
}
