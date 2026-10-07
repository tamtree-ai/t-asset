import Link from "next/link";
import type { ReactNode } from "react";

import { signOutAction } from "@/app/sign-in/actions";
import { type Crumb, PageHeader } from "@/components/PageHeader";
import { bytesLabel } from "@/lib/studio/format";
import { studioMember } from "@/lib/studio/member";
import { storageUsed } from "@/services/studio/storage";

/** The studio's top bar: breadcrumbs, the storage meter (plan §5.6), Brand and Sign out. */
export async function StudioHeader({ trail, trailing }: { trail: Crumb[]; trailing?: ReactNode }) {
  const member = await studioMember();
  const used = await storageUsed(member.orgId);
  const pct = Math.min(100, Math.round((used.bytes / used.capBytes) * 100));
  const tone = pct >= 90 ? "bg-[#ff9a8a]" : pct >= 70 ? "bg-attention" : "bg-fg-3";
  return (
    <PageHeader
      trail={[{ label: "Studio", href: "/studio" }, ...trail]}
      trailing={
        <>
          {trailing}
          <span className="hidden items-center gap-2 px-2 text-[12px] text-fg-3 sm:flex" title={`Uploads stop at ${bytesLabel(used.capBytes)} so the free Blob store never goes over its 1 GB.`}>
            <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-line">
              <span className={`block h-full ${tone}`} style={{ width: `${pct}%` }} />
            </span>
            <span data-testid="storage-meter">
              {bytesLabel(used.bytes)} of {bytesLabel(used.capBytes)}
            </span>
          </span>
          <Link href="/settings/brand" className="rounded-md px-2 py-1 text-[13px] text-fg-3 hover:bg-hover hover:text-fg">
            Brand
          </Link>
          <form action={signOutAction}>
            <button type="submit" className="rounded-md px-2 py-1 text-[13px] text-fg-3 hover:bg-hover hover:text-fg">
              Sign out
            </button>
          </form>
        </>
      }
    />
  );
}
