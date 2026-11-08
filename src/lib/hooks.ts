/**
 * Hooks, the pure parts (planning/2026-10-07-tasset-workflow-hooks §4–5, as adopted by
 * planning/2026-11-08-review-loop §3): the event catalogue, the signed headers, the retry
 * schedule and the push-URL check. No server imports, so tests and scripts share them.
 */
import { signatureHeaders } from "./tamtree";

/** What a hook can ask for. Internal comments never become events, so they never reach a hook. */
export const HOOK_EVENTS = [
  { type: "comment.added", label: "A comment is added", group: "Comments" },
  { type: "comment.replied", label: "A reply is added", group: "Comments" },
  { type: "comment.resolved", label: "A comment is resolved", group: "Comments" },
  { type: "decision.approved", label: "The client approves a version", group: "Decisions" },
  { type: "decision.changes_requested", label: "The client asks for changes", group: "Decisions" },
  { type: "version.released", label: "Versions are released to the client", group: "Versions" },
  { type: "file.ready", label: "A file finished processing", group: "Versions" },
  { type: "file.failed", label: "A file failed processing", group: "Versions" },
  { type: "share.opened", label: "A client signs in to a review link", group: "Review links" },
  { type: "reviewer.joined", label: "Someone signs in to a review link for the first time", group: "Review links" },
  { type: "owner.signed_in", label: "The owner signs in to the studio", group: "Studio" },
] as const;

export type HookEventType = (typeof HOOK_EVENTS)[number]["type"];
/** Sent only by Send test, only to that hook; never chosen. */
export const TEST_EVENT = "test.ping";

export const HOOK_EVENT_TYPES: readonly string[] = HOOK_EVENTS.map((e) => e.type);
export const isHookEvent = (t: string): t is HookEventType => HOOK_EVENT_TYPES.includes(t);

export const ENVELOPE_VERSION = 1;
export const MAX_HOOKS = 10;
/** Sends at once, and how long each may take. */
export const DELIVERY_CONCURRENCY = 10;
export const DELIVERY_TIMEOUT_MS = 10_000;
/** After the 1st, 2nd and 3rd retryable failure; the 4th failure is final. */
export const RETRY_DELAYS_MS = [3600_000, 6 * 3600_000, 24 * 3600_000] as const;
export const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/** A claimed delivery is someone's for this long; if the sender dies, the sweep takes it after. */
export const CLAIM_LEASE_MS = 2 * 60_000;
/** The pull feed: newest this many, from this far back. */
export const FEED_LIMIT = 200;
export const FEED_WINDOW_MS = 7 * 86_400_000;

/**
 * The headers on every push. Tamtree's Webhook Trigger ("Signed", hmac_sha256) reads the
 * `X-Tamtree-*` pair; the `X-Tasset-*` pair says what the delivery is. Same recipe as the
 * processing webhook: `sha256=` HMAC of `<unix seconds>.<raw body>`.
 */
export function hookHeaders(secret: string, body: string, e: { id: string; type: string; attempt: number }, now = Date.now()): Record<string, string> {
  return {
    "content-type": "application/json",
    "user-agent": "t-asset-hooks/1",
    ...signatureHeaders(secret, Math.floor(now / 1000), body),
    "x-tasset-event": e.type,
    "x-tasset-event-id": e.id,
    "x-tasset-delivery-attempt": String(e.attempt),
  };
}

export type DeliveryResult = { httpStatus: number | null; error: string | null };
export type DeliveryOutcome = { status: "delivered" | "pending" | "failed"; nextAttemptAt: Date | null; error: string | null };

/**
 * What one attempt (1-based) means. 2xx is delivered (Tamtree's `{"filtered": true}` too). 429, 5xx,
 * timeouts and network errors retry 1 h, 6 h, 24 h later, then fail. Any other answer (401, 404,
 * 410, a 400) fails at once: sending the same thing again won't change it.
 */
export function outcomeOf(r: DeliveryResult, attempt: number, now = Date.now()): DeliveryOutcome {
  const s = r.httpStatus;
  if (s !== null && s >= 200 && s < 300) return { status: "delivered", nextAttemptAt: null, error: null };
  const retryable = s === null || s === 429 || s >= 500;
  const error = r.error ?? describeStatus(s!);
  if (!retryable || attempt >= MAX_DELIVERY_ATTEMPTS) return { status: "failed", nextAttemptAt: null, error };
  return { status: "pending", nextAttemptAt: new Date(now + RETRY_DELAYS_MS[attempt - 1]!), error };
}

function describeStatus(s: number): string {
  if (s === 401 || s === 403) return `HTTP ${s}: the receiver refused the signature. Check the secret it has for this hook.`;
  if (s === 404 || s === 410) return `HTTP ${s}: nothing is listening at that address any more.`;
  if (s === 429) return "HTTP 429: the receiver asked us to slow down.";
  if (s >= 300 && s < 400) return `HTTP ${s}: the address redirects. Use the final address.`;
  return `HTTP ${s} from the receiver.`;
}

/**
 * A push URL the owner typed. https only in production, and not an address that only makes sense
 * inside a network. Only the owner can enter one, so this guards against mistakes, not a full SSRF
 * defence (hooks plan §5.6). Returns the problem, or null.
 */
export function urlProblem(raw: string, production: boolean): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "That isn't a web address.";
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && !production)) return production ? "Use an https:// address." : "Use an http:// or https:// address.";
  if (u.username || u.password) return "Leave the user name and password out of the address.";
  if (!production) return null;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return "That address only works inside your own network.";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return "Use a host name, not an IP address.";
  return null;
}
