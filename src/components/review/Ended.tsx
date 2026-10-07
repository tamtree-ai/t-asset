import { BrandMark } from "./BrandMark";

/** "This link has ended": a revoked or expired share, or one that doesn't exist. */
export function Ended({ token, studioName, hasLogo, supportEmail, website, reason }: { token: string; studioName: string; hasLogo: boolean; supportEmail: string | null; website: string | null; reason: "revoked" | "expired" | "missing" }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-[440px] flex-col gap-5 rounded-2xl border border-room-line bg-room-surface p-8 text-center shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_40px_rgb(0_0_0/0.06)]">
        {reason !== "missing" && (
          <div className="flex justify-center">
            <BrandMark token={token} name={studioName} hasLogo={hasLogo} size="lg" />
          </div>
        )}
        <h1 className="font-display text-[34px] leading-[1.05]">{reason === "missing" ? "This link isn't valid" : "This link has ended"}</h1>
        <p className="text-[14.5px] leading-relaxed text-room-muted">
          {reason === "missing"
            ? "Check that you copied the whole address. If it still doesn't work, ask for a new link."
            : reason === "expired"
              ? "The time to review this has passed."
              : "The studio has closed this review."}
          {reason !== "missing" && ` Contact ${studioName} if you need it opened again.`}
        </p>
        {(supportEmail || website) && (
          <p className="text-[14px]">
            {supportEmail && (
              <a href={`mailto:${supportEmail}`} className="font-medium text-brand-text underline underline-offset-2">
                {supportEmail}
              </a>
            )}
            {supportEmail && website && <span className="text-room-muted"> · </span>}
            {website && (
              <a href={website} rel="noopener noreferrer" className="font-medium text-brand-text underline underline-offset-2">
                {website.replace(/^https?:\/\//, "")}
              </a>
            )}
          </p>
        )}
      </div>
    </main>
  );
}
