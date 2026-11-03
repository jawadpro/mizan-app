import BalanceCard from "@/components/BalanceCard";
import DailyReminder from "@/components/DailyReminder";
import Dashboard from "@/components/Dashboard";
import RamadanNotice from "@/components/RamadanNotice";
import { FAITH_FEATURES } from "@/lib/features";

export default function Page() {
  return (
    <>
      <div className={FAITH_FEATURES ? "top-row" : "top-row solo"}>
        <BalanceCard />
        {FAITH_FEATURES && <DailyReminder />}
      </div>
      {FAITH_FEATURES && <RamadanNotice />}
      <Dashboard space="app" />
    </>
  );
}
