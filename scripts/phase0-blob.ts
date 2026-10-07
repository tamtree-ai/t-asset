/**
 * Phase 0 (plan §8): checks the parts of Vercel Blob that local tests can't, against a real private
 * store. Run once a Blob store exists:
 *
 *   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_… pnpm phase0
 *
 * It uploads a small file with the hand-built signed PUT Tamtree will use, reads it back through a
 * signed GET (whole, and a byte range, which video seeking needs), checks `download=1` names the
 * file, then deletes it. Nothing is left in the store. Browser multipart uploads and iPhone Safari
 * playback still need a deployed app (see the handover).
 */
import { randomUUID } from "node:crypto";

import { VercelBlobStore } from "../src/lib/blob/vercel";

const results: { check: string; ok: boolean; detail: string }[] = [];
const record = (check: string, ok: boolean, detail = "") => {
  results.push({ check, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${check}${detail ? `  (${detail})` : ""}`);
};

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.VERCEL_OIDC_TOKEN) throw new Error("Set BLOB_READ_WRITE_TOKEN (from the Blob store's settings on Vercel).");
  const store = new VercelBlobStore();
  const key = `phase0/${randomUUID()}/Teaser final v2.txt`.replace(/ /g, "-");
  const body = "0123456789abcdefghij".repeat(10);

  try {
    const target = await store.uploadTarget(key, { contentType: "text/plain", maxBytes: body.length, validForS: 300 });
    const put = await fetch(target.url, { method: target.method, headers: target.headers, body });
    record("signed PUT with hand-built headers (Tamtree's upload)", put.ok, `${put.status} ${put.ok ? "" : await put.text()}`.trim());

    const tooBig = await store.uploadTarget(`${key}.big`, { contentType: "text/plain", maxBytes: 5, validForS: 300 });
    const refused = await fetch(tooBig.url, { method: "PUT", headers: tooBig.headers, body });
    record("signed PUT refuses a body over maxBytes", !refused.ok, String(refused.status));

    const h = await store.head(key);
    record("head sees the size and type", h?.size === body.length && (h?.contentType ?? "").startsWith("text/plain"), JSON.stringify(h));

    const url = await store.readUrl(key, { validForS: 300 });
    const whole = await fetch(url);
    record("signed GET returns the file", whole.ok && (await whole.text()) === body, String(whole.status));

    const ranged = await fetch(url, { headers: { range: "bytes=10-19" } });
    const slice = await ranged.text();
    record("signed GET honours Range with 206 (video seeking)", ranged.status === 206 && slice === "abcdefghij", `${ranged.status} ${ranged.headers.get("content-range") ?? ""}`);

    const dl = await fetch(await store.readUrl(key, { validForS: 300, download: true }));
    const cd = dl.headers.get("content-disposition") ?? "";
    record("download=1 saves under the file's name", cd.includes("attachment") && cd.includes("Teaser-final-v2.txt"), cd || "no content-disposition");

    const expired = await fetch(await store.readUrl(key, { validForS: -60 }).catch(() => url.replace(/vercel-blob-valid-until=\d+/, "vercel-blob-valid-until=1")));
    record("an expired signed GET is refused", !expired.ok, String(expired.status));
  } finally {
    await store.delete([key, `${key}.big`]).catch(() => undefined);
    record("delete leaves nothing behind", (await store.head(key)) === null);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\n${failed.length} check(s) failed. See docs/tamtree-contract.md and the plan's §10 for the fallbacks.` : "\nAll Phase 0 Blob checks passed.");
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
