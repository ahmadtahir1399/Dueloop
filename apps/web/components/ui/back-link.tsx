import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-11 w-fit items-center gap-1 t-body-sm font-medium text-link hover:underline">
      <ChevronLeft aria-hidden="true" className="size-4" />
      {children}
    </Link>
  );
}
