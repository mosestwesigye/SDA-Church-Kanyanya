import type { Metadata } from "next";
import { HouseholdDetail } from "@/components/groups/household-pages";

export const metadata: Metadata = { title: "Cell" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <HouseholdDetail kind="CELL" id={(await params).id} />;
}
