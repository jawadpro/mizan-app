import Link from "next/link";
export default function NotFound() {
  return (
    <div className="login-wrap"><div className="card state"><div className="icon">🧭</div><h3>Page not found</h3><p><Link href="/">Back to Mizan</Link></p></div></div>
  );
}
