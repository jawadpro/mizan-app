import BalanceCard from "@/components/BalanceCard";
import Dashboard from "@/components/Dashboard";
import RamadanNotice from "@/components/RamadanNotice";
import { DEFAULT_PREFS } from "@/lib/preferences";
import { getPrefs } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function Page() {
  const prefs = await getPrefs().catch(() => DEFAULT_PREFS);
  return (
    <Dashboard
      space="app"
      defaultPreset={prefs.defaultRange}
      top={
        <>
          <div className="top-row">
            <BalanceCard />
          </div>
          {prefs.ramadanNotice && <RamadanNotice />}
        </>
      }
    />
  );
}
