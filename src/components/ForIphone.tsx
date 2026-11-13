"use client";
import { useEffect, useState, type ReactNode } from "react";
import { isIphone } from "./paired-devices";

/** Shows `iphone` when the page is open on an iPhone, otherwise `other` (also while the page first loads). */
export default function ForIphone({ iphone, other }: { iphone: ReactNode; other: ReactNode }) {
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isIphone()), []);
  return <>{phone ? iphone : other}</>;
}
