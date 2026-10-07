"use client";

import { retryProcessingAction } from "@/app/studio/actions";

import { ActionButton } from "./Actions";
import { cardCls } from "./kit";

/** Above the room while Tamtree hasn't finished a file: what's happening, and Retry when it failed. */
export function ProcessingNotice({ fileId, assetId, state, error }: { fileId: string; assetId: string; state: "uploading" | "pending" | "failed"; error: string | null }) {
  const failed = state === "failed";
  return (
    <div role="status" className={`${cardCls} flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${failed ? "border-attention-line bg-attention-soft" : ""}`}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13.5px] font-medium">
          {failed ? (
            <>
              <span aria-hidden className="text-attention">▲ </span>Tamtree couldn&rsquo;t prepare this file
            </>
          ) : (
            "Tamtree is preparing this file"
          )}
        </span>
        <span className="text-[12.5px] text-fg-muted">
          {failed ? (error ?? "No reason was given.") : `Previews, thumbnails and the watermark appear here when it's done.${error ? ` Last try: ${error}` : ""}`}
        </span>
      </div>
      <ActionButton action={() => retryProcessingAction(fileId, assetId)}>{failed ? "Retry" : "Send to Tamtree again"}</ActionButton>
    </div>
  );
}
