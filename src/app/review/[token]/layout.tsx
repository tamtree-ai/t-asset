import type { Metadata } from "next";
import type { ReactNode } from "react";

import { brandCss } from "@/lib/studio/color";
import { findShareByToken } from "@/services/studio/access";
import { DEFAULT_BRAND, getBrand } from "@/services/studio/brand";

export const metadata: Metadata = {
  title: "Review",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** The room's theme: the studio's accent and light/dark choice become CSS variables for everything below. */
export default async function ReviewLayout({ children, params }: { children: ReactNode; params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await findShareByToken(token);
  const brand = share ? await getBrand(share.orgId) : null;
  const css = brandCss(brand?.accentHex ?? DEFAULT_BRAND.accentHex, brand?.roomTheme ?? "light");
  return (
    <div className="room flex min-h-dvh flex-col">
      <style>{css}</style>
      {children}
    </div>
  );
}
