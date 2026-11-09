import { Loading } from "@/components/States";

/** Shown at once while a page that was not prefetched is on its way, so a tap never feels ignored. */
export default function PageLoading() {
  return (
    <div className="card" style={{ marginTop: 4 }}>
      <Loading rows={5} />
    </div>
  );
}
