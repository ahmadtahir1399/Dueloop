import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Dueloop</CardTitle>
          <CardDescription>Follow up on unpaid invoices without the awkward part.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="sign-in">
            <TabsList className="mb-4 grid w-full grid-cols-2">
              <TabsTrigger value="sign-in">Sign in</TabsTrigger>
              <TabsTrigger value="sign-up">Create account</TabsTrigger>
            </TabsList>
            <TabsContent value="sign-in">
              <LoginForm mode="sign-in" />
            </TabsContent>
            <TabsContent value="sign-up">
              <LoginForm mode="sign-up" />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </main>
  );
}
