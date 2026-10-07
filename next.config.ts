import type { NextConfig } from "next";

/** Files are served by redirect to a short-lived signed URL on Vercel Blob's host (plan §5.4). */
const BLOB_HOST = "https://*.blob.vercel-storage.com";

/** The review room: the URL carries a credential, so it must not leak in a Referer, be framed, or be indexed. */
const REVIEW_CSP = [
  "default-src 'self'",
  `img-src 'self' data: blob: ${BLOB_HOST}`,
  `media-src 'self' blob: ${BLOB_HOST}`,
  "style-src 'self' 'unsafe-inline'",
  // Next's own bootstrap is inline; dev also needs eval for React's debugging.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/review/:path*",
        headers: [
          { key: "Content-Security-Policy", value: REVIEW_CSP },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
  // The app is opened at 127.0.0.1. Dev HMR and client boot are blocked without this.
  allowedDevOrigins: ["127.0.0.1"],
  // Playwright uses its own output so `pnpm dev` can stay up.
  distDir: process.env.TASSET_DIST_DIR || ".next",
};

export default nextConfig;
