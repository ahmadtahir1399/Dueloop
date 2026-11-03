import { redirect } from "next/navigation";

/** The old address: links in old emails and bookmarks keep working. */
export default function LoginPage() {
  redirect("/sign-in");
}
