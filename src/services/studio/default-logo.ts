/** The studio's own logo, used on invoices until another one is uploaded in Invoicing settings. */
import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

/** Shipped with the server bundle by `outputFileTracingIncludes` in next.config.ts. */
export const DEFAULT_LOGO_PATH = path.join(process.cwd(), "src/assets/invoice-logo.png");

let cached: string | null | undefined;

/** The default logo as a data URL, or null if the file is missing (then the name prints instead). */
export function defaultInvoiceLogo(): string | null {
  if (cached === undefined) {
    try {
      cached = `data:image/png;base64,${readFileSync(DEFAULT_LOGO_PATH).toString("base64")}`;
    } catch {
      cached = null;
    }
  }
  return cached;
}
