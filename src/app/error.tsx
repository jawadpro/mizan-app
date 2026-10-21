"use client";
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="login-wrap"><div className="card state"><div className="icon">⚠️</div><h3>Something went wrong</h3><p>Please try again.</p><button className="btn primary" onClick={reset}>Try again</button></div></div>
  );
}
