import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid gap-2 rounded-lg border p-6">
      <p className="font-medium">Not found</p>
      <p className="text-sm text-muted-foreground">This page does not exist, or you do not have access to it.</p>
      <Link href="/" className="text-sm underline">
        Back to the overview
      </Link>
    </div>
  );
}
