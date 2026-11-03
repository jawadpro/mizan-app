import { notFound } from "next/navigation";
import Zakat from "@/components/Zakat";
import { FAITH_FEATURES } from "@/lib/features";

export default function Page() {
  if (!FAITH_FEATURES) notFound();
  return <Zakat />;
}
