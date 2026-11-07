import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { getSession } from "@/lib/auth";
import { setupState } from "@/lib/config";

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
  // A new install finishes the setup steps before the workspace opens.
  if (!(await setupState()).done) redirect("/setup");
  return <Shell space="app">{children}</Shell>;
}
