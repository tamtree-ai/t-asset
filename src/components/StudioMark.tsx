import Link from "next/link";

/**
 * The logo and "t-asset" wordmark that start every top bar: one link back to the studio. `large` is the Script artboard's framed mark; the default is the plain square.
 */
export function StudioMark({ large = false }: { large?: boolean }) {
  return (
    <Link href="/studio" aria-label="t-asset — studio home" className="flex shrink-0 items-center gap-2.5 rounded whitespace-nowrap hover:opacity-85">
      {large ? (
        <span aria-hidden className="flex size-[22px] items-center justify-center rounded-md border border-line bg-raised-2">
          <span className="size-2 rounded-full bg-accent" />
        </span>
      ) : (
        <span aria-hidden className="size-4 rounded bg-accent" />
      )}
      <span className={large ? "text-[15px] font-semibold tracking-[-0.01em]" : "text-sm font-semibold tracking-tight"}>t-asset</span>
    </Link>
  );
}
