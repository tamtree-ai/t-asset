# The Tamtree contract

t-asset does no processing. When the owner uploads a file, Tamtree makes everything the review room shows, and reports back over HTTP. This page is what a Tamtree flow needs to implement. `scripts/fake-tamtree.ts` does all of it with ffmpeg and sharp, and is the reference to copy from.

## The flow, step by step

| # | Call | What happens |
|---|---|---|
| 1 | t-asset → `POST $TAMTREE_WEBHOOK_URL` | t-asset sends `{ event: "file.uploaded", fileId, kind, jobUrl }`. It is signed (see "Webhook signature"). The webhook is only a hint, because the flow also polls |
| 1b | `GET /api/tamtree/pending?limit=10` | Files waiting, oldest first: `{ files: [{ fileId, kind, attempts, jobUrl, waitingSince }] }`. Run it from a schedule trigger (every 10 minutes) to catch lost webhooks |
| 2 | `POST /api/tamtree/files/<id>/claim` | Takes the file for 30 minutes. Returns `{ fileId, attempts, claimedUntil }`. **409** means another run holds it or the file isn't waiting: stop quietly |
| 3 | `GET /api/tamtree/files/<id>` | The job (shape below) |
| 4 | Download `source.url` | A signed GET that lasts 1 hour. Hash the bytes with SHA-256 as they arrive |
| 5 | Make the outputs | One per entry in `outputs`, following its `hint` (below) |
| 6 | `POST /api/tamtree/files/<id>/targets` | `{ targets: { <name>: { method: "PUT", url, headers, key, contentType, maxBytes, expiresAt } } }`. Each signed PUT lasts 1 hour. **507** means the studio's storage is full |
| 7 | `PUT target.url` | Send the file as the body, with exactly `target.headers` |
| 8 | `POST /api/tamtree/files/<id>/complete` | Body below. t-asset checks every output is in the store, then marks the file ready |
| 8b | `POST /api/tamtree/files/<id>/fail` | `{ message, retryable }`, if anything goes wrong (below) |

Every `/api/tamtree/*` call needs `Authorization: Bearer $TAMTREE_API_TOKEN`. Errors come back as `{ error }` with status 401, 404, 409, 422, 507 or 500.

## The job

```json
{
  "fileId": "…",
  "state": "pending",
  "kind": "video",
  "mime": "video/quicktime",
  "bytes": 123456789,
  "originalName": "Teaser v3.mov",
  "attempts": 1,
  "source": { "url": "https://…", "expiresAt": "…" },
  "outputs": [
    { "name": "preview", "key": "d/<id>/preview.mp4", "contentType": "video/mp4", "maxBytes": 419430400, "hint": "…" }
  ],
  "watermarkText": "YOUR STUDIO · PREVIEW"
}
```

`source` is null if the original is gone. Fail the file with a message in that case.

## Outputs

| Kind | Name | Type | What to make |
|---|---|---|---|
| image | `preview` | image/webp | Long edge at most 2560 px, EXIF orientation applied, quality about 88 |
| image | `wm_preview` | image/webp | The preview with `watermarkText` tiled over it (`src/lib/studio/watermark.ts` has the SVG) |
| image | `thumb` | image/webp | Long edge at most 480 px |
| video | `preview` | video/mp4 | H.264 + AAC, long edge at most 1280 px, about 2.5 Mb/s, yuv420p, `+faststart` |
| video | `wm_preview` | video/mp4 | The same, with the watermark burnt in |
| video | `poster` | image/jpeg | A frame from about 10% in, same size as the preview |
| video | `thumb` | image/webp | The poster, long edge at most 480 px |

Every file gets its watermarked twin. The share decides which one the client sees. The sizes keep the free 1 GB Blob store and its 10 GB of monthly transfer going.

## Complete

```json
{
  "sha256": "<64 hex characters, of the original as downloaded>",
  "width": 1280,
  "height": 720,
  "durationS": 12.5,
  "fpsNum": 30000,
  "fpsDen": 1001,
  "outputs": { "preview": { "key": "d/<id>/preview.mp4" }, "wm_preview": { "key": "…" }, "poster": { "key": "…" }, "thumb": { "key": "…" } }
}
```

- `width` and `height` are the preview's.
- `durationS`, `fpsNum` and `fpsDen` are required for a video and ignored for an image. Keep the frame rate exact, as ffprobe gives it (30000/1001, not 29.97).
- Each key must be the one the job named.
- **422** lists what's missing.
- Calling complete again with the same keys returns 200 with `alreadyDone: true`.
- After a video completes, t-asset deletes its original unless `KEEP_VIDEO_ORIGINALS=1`.

## Fail

```json
{ "message": "This video couldn't be read. Export it as an H.264 MP4 or MOV and upload it again.", "retryable": false }
```

The owner reads the message next to a Retry button, so write it for them.

- **`retryable: true`** is for a crash, a timeout or a network error. The file goes back in the queue until its third attempt, then it is marked failed.
- **`retryable: false`** marks it failed at once. Use it for a file that can't be read.

## Webhook signature

Headers:
- `x-tasset-timestamp`: Unix seconds
- `x-tasset-signature`: `sha256=<hex>`, the HMAC-SHA256 of `<timestamp>.<raw body>` keyed with `TAMTREE_WEBHOOK_SECRET`

Refuse a bad signature, or a timestamp more than 5 minutes off. `verifyWebhook` in `src/lib/tamtree.ts` does exactly this.

## Not yet checked against real Vercel Blob

The signed PUT for outputs is built by hand in `src/lib/blob/vercel.ts`. It copies the headers the SDK sends: `x-vercel-blob-access`, `x-content-type`, `x-api-version`, `x-vercel-blob-store-id`. Phase 0 must try one real upload this way before the flow relies on it. If it fails, the fallback is for Tamtree to call `put()` from `@vercel/blob` with the presigned payload instead.
