import { SkeletonRows } from "@/components/ui/states";

export default function Loading() {
  return (
    <main className="p-4 md:p-7 pt-[88px] md:pt-[92px]">
      <div className="skeleton h-8 w-64 mb-6" />
      <SkeletonRows rows={8} />
    </main>
  );
}
