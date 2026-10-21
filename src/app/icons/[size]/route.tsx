import { appIcon } from "@/lib/app-icon";

const SIZES = [192, 512];

export const dynamic = "force-static";
export function generateStaticParams() {
  return SIZES.map((s) => ({ size: String(s) }));
}

/** Home-screen icons referenced by the web manifest. */
export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const n = Number((await params).size);
  if (!SIZES.includes(n)) return new Response("Not found", { status: 404 });
  return appIcon(n);
}
