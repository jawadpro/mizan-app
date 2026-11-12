import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { setupState } from "@/lib/config";
import { ToastProvider } from "@/components/Toast";
import SetupWizard from "./SetupWizard";
import "../extra.css";
import "../settings.css";
import "../setup.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up Mizan" };

/** First run on a new install: database check, passphrase, banks, name, iPhone Shortcut. */
export default async function SetupPage() {
  const state = await setupState();
  let signedIn = false;
  try {
    signedIn = !!(await getSession());
  } catch {
    signedIn = false;
  }
  if (state.done) redirect(signedIn ? "/app" : "/login");
  if (state.hasPassword && !signedIn) redirect("/login");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "your-app.vercel.app";
  return (
    <ToastProvider>
      <SetupWizard db={state.db} hasPassword={state.hasPassword} endpoint={`https://${host}/api/sms`} />
    </ToastProvider>
  );
}
