import Link from "next/link";
import type { ReactNode } from "react";

import { StudioMark } from "./StudioMark";

export type Crumb = { href?: string; label: string; display?: boolean };

/**
 * The shared top bar: wordmark and breadcrumbs on the left, an optional center
 * (the step nav), and trailing actions on the right. The center stays centered
 * because the side columns share the leftover width.
 */
export function PageHeader({
  trail = [],
  center,
  trailing,
  tall = false,
}: {
  trail?: Crumb[];
  center?: ReactNode;
  trailing?: ReactNode;
  tall?: boolean;
}) {
  return (
    <header
      className={`grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b bg-panel ${
        tall ? "h-[60px] border-rule-2 px-5" : "h-[52px] border-rule px-4"
      }`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <StudioMark large={tall} />
        {trail.map((item, i) => (
          <span key={`${item.label}-${i}`} className="flex min-w-0 items-center gap-2.5">
            <span className={`text-[#3a3a42] ${tall ? "text-lg" : "text-sm"}`}>/</span>
            {item.href ? (
              <Link href={item.href} className="shrink-0 text-[13px] text-fg-3 hover:text-fg">
                {item.label}
              </Link>
            ) : (
              item.display ? (
                <h1 className="m-0 min-w-0 truncate font-display text-[17px] leading-none text-fg italic">{item.label}</h1>
              ) : (
                <span className="truncate text-[13px] text-fg">{item.label}</span>
              )
            )}
          </span>
        ))}
      </div>
      <div className="flex h-full items-center justify-center">{center}</div>
      <div className="flex min-w-0 items-center justify-end gap-2">{trailing}</div>
    </header>
  );
}
