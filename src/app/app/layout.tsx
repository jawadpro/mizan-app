import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { getSession } from "@/lib/auth";
import { setupState } from "@/lib/config";
import { DEFAULT_CURRENCY } from "@/lib/money";
import { getPrefs } from "@/lib/repo";

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
  const currency = (await getPrefs().catch(() => null))?.currency ?? DEFAULT_CURRENCY;
  return <Shell space="app" currency={currency}>{children}</Shell>;
}
