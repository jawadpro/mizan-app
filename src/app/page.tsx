import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** No landing page: go straight to the workspace, or to sign-in. */
export default async function Home() {
  let ok = false;
  try {
    ok = !!(await getSession());
  } catch {
    ok = false;
  }
  redirect(ok ? "/app" : "/login");
}
