import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import LoginForm from "./LoginForm";
import "../extra.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  let signedIn = false;
  try {
    signedIn = !!(await getSession());
  } catch {
    signedIn = false;
  }
  if (signedIn) redirect("/app");
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="brand" style={{ marginBottom: 12 }}><span className="brand-mark" aria-hidden>م</span> Mizan</div>
        <h1 style={{ fontSize: "1.5rem" }}>Welcome back</h1>
        <p className="muted" style={{ marginTop: 4 }}>Enter your passphrase to open your finances.</p>
        <Suspense><LoginForm /></Suspense>
      </div>
    </div>
  );
}
