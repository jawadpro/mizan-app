import BalanceCard from "@/components/BalanceCard";
import DailyReminder from "@/components/DailyReminder";
import Dashboard from "@/components/Dashboard";
import RamadanNotice from "@/components/RamadanNotice";
export default function Page() { return <><div className="top-row"><BalanceCard /><DailyReminder /></div><RamadanNotice /><Dashboard space="app" /></>; }
