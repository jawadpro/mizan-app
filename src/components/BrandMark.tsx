import { BRAND_SRC } from "@/lib/brand";

/** The Mizan logo shown beside the name. */
export default function BrandMark() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="brand-mark" src={BRAND_SRC} width={28} height={28} alt="" aria-hidden />;
}
