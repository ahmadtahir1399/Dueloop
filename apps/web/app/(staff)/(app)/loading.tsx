import { Skeleton } from "@/components/ui/skeleton";

/** M13: static skeleton blocks that pulse (no pulse with reduced motion). */
export default function Loading() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-10 w-72" />
      <div className="grid gap-3 sm:grid-cols-2 wide:grid-cols-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
