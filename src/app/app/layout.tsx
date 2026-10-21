import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workspace" };

/** Server-side gate for the private workspace. API routes check the session independently. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let ok = false;
  try {
    ok = !!(await getSession());
  } catch {
    ok = false;
  }
  if (!ok) redirect("/login");
  return <Shell space="app">{children}</Shell>;
}
