import { describe, expect, it } from "vitest";

import { HOOK_EVENT_TYPES, hookHeaders, MAX_DELIVERY_ATTEMPTS, outcomeOf, urlProblem } from "./hooks";
import { verifyWebhook } from "./tamtree";

const HOUR = 3600_000;

describe("hookHeaders", () => {
  it("signs the way Tamtree's Webhook Trigger checks (X-Tamtree-*), and carries the same signature as X-Tasset-*", () => {
    const now = Date.UTC(2026, 10, 9, 12);
    const body = JSON.stringify({ id: "e1", type: "comment.added" });
    const h = hookHeaders("whsec_test", body, { id: "e1", type: "comment.added", attempt: 2 }, now);
    expect(h["x-tamtree-timestamp"]).toBe(String(now / 1000));
    expect(h["x-tamtree-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(h["x-tasset-signature"]).toBe(h["x-tamtree-signature"]);
    expect(h).toMatchObject({ "x-tasset-event": "comment.added", "x-tasset-event-id": "e1", "x-tasset-delivery-attempt": "2" });
    expect(verifyWebhook("whsec_test", h["x-tamtree-timestamp"]!, body, h["x-tamtree-signature"]!, now)).toBe(true);
    expect(verifyWebhook("whsec_test", h["x-tamtree-timestamp"]!, body + " ", h["x-tamtree-signature"]!, now)).toBe(false);
    expect(verifyWebhook("other", h["x-tamtree-timestamp"]!, body, h["x-tamtree-signature"]!, now)).toBe(false);
    expect(verifyWebhook("whsec_test", h["x-tamtree-timestamp"]!, body, h["x-tamtree-signature"]!, now + 6 * 60_000)).toBe(false);
  });
});

describe("outcomeOf", () => {
  const now = 1_000_000;
  it("counts any 2xx as delivered", () => {
    expect(outcomeOf({ httpStatus: 200, error: null }, 1, now).status).toBe("delivered");
    expect(outcomeOf({ httpStatus: 204, error: null }, 4, now).status).toBe("delivered");
  });
  it("fails at once on 401, 404, 410 and other 4xx", () => {
    for (const s of [400, 401, 403, 404, 410, 422]) expect(outcomeOf({ httpStatus: s, error: null }, 1, now)).toMatchObject({ status: "failed", nextAttemptAt: null });
    expect(outcomeOf({ httpStatus: 401, error: null }, 1, now).error).toMatch(/signature/);
  });
  it("retries 429, 5xx, timeouts and network errors after 1 h, 6 h, 24 h, then fails", () => {
    for (const r of [{ httpStatus: 503, error: null }, { httpStatus: 429, error: null }, { httpStatus: null, error: "No answer in 10 seconds." }]) {
      expect(outcomeOf(r, 1, now)).toMatchObject({ status: "pending", nextAttemptAt: new Date(now + HOUR) });
      expect(outcomeOf(r, 2, now)).toMatchObject({ status: "pending", nextAttemptAt: new Date(now + 6 * HOUR) });
      expect(outcomeOf(r, 3, now)).toMatchObject({ status: "pending", nextAttemptAt: new Date(now + 24 * HOUR) });
      expect(outcomeOf(r, MAX_DELIVERY_ATTEMPTS, now)).toMatchObject({ status: "failed", nextAttemptAt: null });
    }
    expect(outcomeOf({ httpStatus: null, error: "No answer in 10 seconds." }, 1, now).error).toBe("No answer in 10 seconds.");
  });
});

describe("urlProblem", () => {
  it("wants https in production and refuses addresses that only work inside a network", () => {
    expect(urlProblem("https://hooks.example.com/x", true)).toBeNull();
    expect(urlProblem("http://hooks.example.com/x", true)).toMatch(/https/);
    for (const u of ["https://localhost/x", "https://box.local/x", "https://svc.internal/x", "https://10.0.0.1/x", "https://[::1]/x"]) expect(urlProblem(u, true)).not.toBeNull();
    expect(urlProblem("https://u:p@hooks.example.com", true)).toMatch(/password/);
    expect(urlProblem("not a url", true)).not.toBeNull();
    expect(urlProblem("ftp://example.com", true)).not.toBeNull();
  });
  it("allows a local http address in development", () => {
    expect(urlProblem("http://localhost:4100/hook", false)).toBeNull();
    expect(urlProblem("ftp://example.com", false)).not.toBeNull();
  });
});

describe("catalogue", () => {
  it("holds the events the review loop needs, and never test.ping or the feed-only ones", () => {
    for (const t of ["comment.added", "comment.replied", "comment.resolved", "decision.approved", "decision.changes_requested", "version.released", "file.ready", "file.failed", "share.opened", "reviewer.joined", "owner.signed_in"]) {
      expect(HOOK_EVENT_TYPES).toContain(t);
    }
    for (const t of ["test.ping", "comment.hidden", "comment.reopened", "share.created", "invoice.paid"]) expect(HOOK_EVENT_TYPES).not.toContain(t);
  });
});
