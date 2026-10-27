import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AuthCodeErrorPage() {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>That link did not work</CardTitle>
          <CardDescription>It may have expired or already been used. Sign in again, or create the account again.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/login">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
