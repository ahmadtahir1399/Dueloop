import { devOnly } from "@/lib/dev-only";
import { LoopDev } from "./loop-dev";

export const metadata = { robots: { index: false, follow: false } };

/** /dev/loop?beat=N&still=1: the real scene frozen in the middle of beat N, ambient time 0 (§6.2.6). Dev only. */
export default async function DevLoopPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  devOnly();
  const sp = await searchParams;
  const beat = Math.min(7, Math.max(0, Number(typeof sp.beat === "string" ? sp.beat : "0") || 0));
  const still = sp.still === "1";
  const size = Number(typeof sp.size === "string" ? sp.size : "1200") || 1200;
  return <LoopDev beat={beat} still={still} size={size} />;
}
