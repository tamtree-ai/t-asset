import { redirect } from "next/navigation";

import { CompareView } from "@/components/review/CompareView";
import { Ended } from "@/components/review/Ended";
import { getBrand } from "@/services/studio/brand";
import { guestState } from "@/services/studio/guest";
import { latestSignoffs, toView } from "@/services/studio/room-data";
import { loadShareContent } from "@/services/studio/room";
import { threadsAction } from "../actions";

export const dynamic = "force-dynamic";

/** Two versions of one asset, side by side or (images) under a slider. `?asset=&a=&b=`: a defaults to the version before b. */
export default async function ComparePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ asset?: string; a?: string; b?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const g = await guestState(token);
  if (g.kind !== "room") redirect(`/review/${token}`);

  const content = await loadShareContent(g.share);
  const brand = await getBrand(g.share.orgId);
  const found = content.find((a) => a.id === sp.asset) ?? content.find((a) => a.variations.some((v) => v.versions.some((x) => x.id === sp.b))) ?? content[0];
  if (!found) return <Ended token={token} studioName={brand.studioName} hasLogo={false} supportEmail={brand.supportEmail} website={brand.website} reason="revoked" />;

  const signoffs = await latestSignoffs(found.variations.flatMap((v) => v.versions.map((x) => x.id)));
  const [asset] = toView(g.share, [found], signoffs);

  // Right side: ?b, else the newest version of the first option. Left side: ?a, else the one before it (or the same, if there's only one).
  const all = asset!.variations.flatMap((v) => v.versions.map((x) => ({ variationId: v.id, versionId: x.id })));
  const pick = (id?: string) => all.find((x) => x.versionId === id);
  const firstVar = asset!.variations[0]!;
  const b = pick(sp.b) ?? { variationId: firstVar.id, versionId: firstVar.versions[firstVar.versions.length - 1]!.id };
  const sameVar = asset!.variations.find((v) => v.id === b.variationId)!;
  const idx = sameVar.versions.findIndex((x) => x.id === b.versionId);
  const a = pick(sp.a) ?? { variationId: sameVar.id, versionId: sameVar.versions[Math.max(0, idx - 1)]!.id };

  return <CompareView token={token} asset={asset!} initial={{ a, b }} loadThreads={threadsAction.bind(null, token)} backHref={`/review/${token}?v=${b.versionId}`} />;
}
