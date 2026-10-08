import { SkeletonRows } from "@/components/ui/states";

export default function Loading() {
  return (
    <main className="p-4 md:p-7">
      <div className="skeleton mb-6 h-8 w-56" />
      <SkeletonRows rows={8} />
    </main>
  );
}
