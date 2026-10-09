import type { Metadata } from "next";
import { HouseholdList } from "@/components/groups/household-pages";

export const metadata: Metadata = { title: "Cells" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  return <HouseholdList kind="CELL" q={(await searchParams).q} />;
}
