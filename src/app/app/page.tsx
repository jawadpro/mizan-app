import Dashboard from "@/components/Dashboard";
import MonthlyStrip from "@/components/MonthlyStrip";
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
      showBalance
      top={
        <>
          <MonthlyStrip />
          {prefs.ramadanNotice && <RamadanNotice />}
        </>
      }
    />
  );
}
