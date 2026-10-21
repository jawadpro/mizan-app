"use client";

export function Skeleton({ h = 18, w = "100%" }: { h?: number; w?: number | string }) {
  return <div className="skeleton" style={{ height: h, width: w }} aria-hidden />;
}

export function Loading({ rows = 4, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div className="grid" style={{ gap: 10 }} aria-busy="true">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} h={22} w={`${90 - i * 9}%`} />
      ))}
    </div>
  );
}

export function Empty({ icon = "🌿", title, children }: { icon?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="state">
      <div className="icon" aria-hidden>{icon}</div>
      <h3>{title}</h3>
      {children && <div>{children}</div>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert error" role="alert">
      <span>{message}</span>
      {onRetry && <button className="btn sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}
