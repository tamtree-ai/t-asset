/** The studio's mark in the room: an accent square and the name. `hasLogo` is kept for when logos come back; v1 has none. */
export function BrandMark({ name, size = "md" }: { token: string; name: string; hasLogo: boolean; size?: "md" | "lg" }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span aria-hidden className={`${size === "lg" ? "size-10" : "size-7"} shrink-0 rounded-lg bg-brand`} />
      <span className={`truncate font-semibold tracking-[-0.01em] ${size === "lg" ? "text-[17px]" : "text-[14px]"}`}>{name}</span>
    </span>
  );
}
