# Hooks

A hook tells another tool when something happens in the studio: a client comments, decides, or
signs in; a version is released; a file finishes processing. tamshoot uses one to hear about
comments on its scripts and renders; a Tamtree workflow can use one to email the owner. Any HTTPS
endpoint can be a subscriber.

The owner sets them up in **Settings → Hooks** (`/settings/hooks`). A studio holds up to 10.

- **Push** (recommended): t-asset POSTs each event to an address, signed, and retries for about a day.
- **Pull**: the tool reads a feed of recent events with a bearer token. For a receiver the internet can't reach.

**Internal comments are never events.** Nothing an owner or editor marks internal ever reaches a hook.

## Events

| Type | When |
|---|---|
| `comment.added` | A comment on a version (by a client, or by the studio when not internal) |
| `comment.replied` | A reply to a comment |
| `comment.resolved` | A comment is resolved |
| `decision.approved` | A client approves a version (signed off by name) |
| `decision.changes_requested` | A client asks for changes |
| `version.released` | The owner releases versions to the client (one event per project per release) |
| `file.ready` | Tamtree finished making a version's previews |
| `file.failed` | Tamtree gave up on a version's file |
| `share.opened` | A client signs in to a review link: every sign-in, at most once per person per 30 minutes |
| `reviewer.joined` | Someone signs in to a review link for the first time |
| `owner.signed_in` | The owner signs in to the studio |
| `test.ping` | **Send test** on the hook page. Goes to that hook only; you can't subscribe to it |

`comment.reopened`, `comment.hidden`, `share.created`, `share.revoked`, `version.uploaded`,
`file.downloaded` and the invoice events stay in the activity feed only.

## The envelope

Every delivery (and every feed item) is one JSON object. It is built when it is sent, so it shows
the current names. `v` is the envelope version: fields are only ever added, and a breaking change
would be `v: 2`. Fields that don't apply are `null`.

```json
{
  "id": "6f1c2a…",
  "type": "comment.added",
  "v": 1,
  "occurredAt": "2026-11-09T09:14:03.120Z",
  "studio": { "name": "Tamshoot", "ownerEmail": "owner@example.com" },
  "project": { "id": "e8b0…", "name": "Spring campaign", "studioUrl": "https://review.example.com/studio/projects/e8b0…" },
  "client": { "name": "Acme" },
  "share": { "id": "41d2…", "title": "Round 2", "studioUrl": "https://review.example.com/studio/shares/41d2…" },
  "actor": { "kind": "reviewer", "name": "Sam Lee", "email": "sam@acme.com" },
  "asset": { "id": "9a7e…", "title": "Skit 12: script", "kind": "video", "externalRef": "tamshoot:project/8f2c/script" },
  "version": { "id": "c3f0…", "number": 2, "externalRef": "tamshoot:script/8f2c/rev-2", "released": true },
  "comment": { "id": "77ab…", "number": 3, "parentId": null, "body": "Can the second line be shorter?", "annotation": { "v": 1, "shape": "pin", "x": 0.4, "y": 0.6 } },
  "data": { "where": "Skit 12: script · Main v2", "number": 3, "excerpt": "Can the second line be shorter?", "byStudio": false }
}
```

- `id` is the event's id: the same on every retry, so use it to ignore a repeat.
- `actor.kind` is `reviewer` (a client, with their email), `studio` (the owner or an editor), `owner`
  (`owner.signed_in`), `api` (a Review API token) or `system` (Tamtree, for `file.*`).
- `externalRef` is the producer's own name for the asset or version, as sent to the Review API
  ([review-api.md](review-api.md)). tamshoot matches events to its own records with it.
- `comment.number` is the thread's `#n`; for a reply it is its root's number, and `parentId` is the root.

What `data` holds, per type:

| Type | `data` |
|---|---|
| `comment.added`, `comment.replied` | `where`, `number`, `excerpt` (160 characters), `byStudio`, `commentId`, `versionId`; replies add `parentId` |
| `comment.resolved` | `where`, `number`, `commentId` |
| `decision.approved`, `decision.changes_requested` | `where`, `versionId`, `decisionId`, `note` (the client's note, or null), `reviewerId` |
| `version.released` | `where`, `count`, `versionIds`, and `versions: [{ id, number, externalRef, released, asset }]`. `version` and `asset` are set when exactly one was released |
| `file.ready` | `where`, `versionId`, `fileId` |
| `file.failed` | `where`, `versionId`, `fileId`, `error` (Tamtree's message) |
| `share.opened` | `reviewerId`, `firstVisit` (true the first time this email signs in to this link) |
| `reviewer.joined` | `reviewerId` |
| `owner.signed_in` | `email`, `ip` |
| `test.ping` | `subscriptionId`, `hook` (the hook's name) |

Examples of the parts that differ:

```json
{ "type": "decision.changes_requested", "actor": { "kind": "reviewer", "name": "Sam Lee", "email": "sam@acme.com" },
  "version": { "id": "c3f0…", "number": 2, "externalRef": "tamshoot:render/8f2c/take-2", "released": true },
  "comment": null, "data": { "where": "Skit 12 · Main v2", "versionId": "c3f0…", "decisionId": "5e1d…", "note": "Music too loud", "reviewerId": "a1b2…" } }

{ "type": "version.released", "actor": { "kind": "studio", "name": "You", "email": null }, "share": null,
  "data": { "where": "Skit 12 v2, Skit 13 v1", "count": 2, "versionIds": ["c3f0…", "d4e1…"],
            "versions": [{ "id": "c3f0…", "number": 2, "externalRef": null, "released": true, "asset": { "id": "9a7e…", "title": "Skit 12", "kind": "video", "externalRef": null } }, …] } }

{ "type": "file.failed", "actor": { "kind": "system", "name": "Tamtree", "email": null },
  "data": { "where": "Skit 12 · Main v3", "versionId": "e5f2…", "fileId": "0b9c…", "error": "Couldn't decode the video." } }

{ "type": "share.opened", "share": { "id": "41d2…", "title": "Round 2", "studioUrl": "…" },
  "actor": { "kind": "reviewer", "name": "Sam Lee", "email": "sam@acme.com" }, "asset": null, "version": null,
  "data": { "reviewerId": "a1b2…", "firstVisit": false } }

{ "type": "test.ping", "project": null, "actor": { "kind": "studio", "name": "Dilhan", "email": null },
  "data": { "subscriptionId": "f00d…", "hook": "tamshoot: comments" } }
```

## Push

```
POST <the hook's address>
content-type: application/json
x-tamtree-timestamp: 1762679643
x-tamtree-signature: sha256=<hex>
x-tasset-timestamp: 1762679643          (the same values, for receivers that read these)
x-tasset-signature: sha256=<hex>
x-tasset-event: comment.added
x-tasset-event-id: 6f1c2a…
x-tasset-delivery-attempt: 1

<the envelope>
```

**Checking the signature.** The signature is `sha256=` and the hex HMAC-SHA256 of
`<timestamp>.<raw body>`, keyed with the hook's secret (`whsec_…`, shown once when the hook is made
or its secret rotated). Refuse a signature that doesn't match, or a timestamp more than 5 minutes
off. Compute it over the raw bytes you received, before parsing the JSON.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret: string, ts: string | null, rawBody: string, sig: string | null): boolean {
  if (!ts || !sig || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const want = Buffer.from(`sha256=${createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex")}`);
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
```

**Tamtree.** A Webhook Trigger checks it with no code: Verify sender → **Signed**, and a *Webhook
signing secret* credential holding the hook's secret.

**What counts.**

| The receiver answers | t-asset |
|---|---|
| Any 2xx (Tamtree's `200 {"filtered": true}` too) | Delivered |
| 429, 5xx, no answer in 10 seconds, or can't connect | Tries again 1 hour, 6 hours and 24 hours later, then gives up (4 attempts) |
| Anything else (400, 401, 403, 404, 410, a redirect) | Gives up at once, and shows the error on the hook page |

Redirects are not followed: give the final address. Retries are sent by the daily cleanup, so on
Vercel Hobby a retry can be up to a day late. `POST /api/hooks/redeliver` with
`Authorization: Bearer $TAMTREE_API_TOKEN` runs the same sweep sooner (a Tamtree Schedule Trigger
can call it; hourly at most on Neon). The hook page has **Redeliver** on any delivery that didn't
arrive.

**At least once.** A receiver that timed out after acting may get the same event again, with the same
`id` and `x-tasset-event-id`. Ignore an id you've already handled.

## Pull

```
GET /api/hooks/<hook id>/events
Authorization: Bearer ttf_…

200 { "items": [envelope, …] }
```

The newest 200 events of the hook's types from the last 7 days, newest first, and none from before
the hook was made. The same events come back on every read until they age out, so **keep the ids you
have handled** and skip them. tamshoot keeps the last id it processed.

- `401` a wrong or missing token, `403` the hook is turned off, `429` more than 60 reads a minute
  (with `retry-after`).
- **Every read wakes the database.** On Neon's free plan, read every 30 minutes or more; more often
  than every 15 minutes uses up the monthly allowance. Against a local t-asset, any interval is fine.
- Tamtree: *Poll for new data*, Where the items are `{{ $json['items'] }}`, Unique field `id`,
  Start a run *Once per new item*, and a Bearer credential holding the token.

## Settings → Hooks

- **Add a hook:** a name, push (with the address) or pull, and the events. The secret or token is
  shown once, with what to paste where.
- **The hook page:** Send test (a `test.ping` to this hook only, with the answer shown), Turn off,
  Rotate secret/token (the old one stops at once), Delete, the events and address, and the last 20
  deliveries with Redeliver.
- Push addresses must be `https://` in production, and not `localhost`, `*.local`, `*.internal` or an
  IP address. A local `http://` address is fine in development.

## Security

- The push secret is stored sealed (AES-256-GCM with `STUDIO_SECRET`), because it is needed to sign;
  the feed token is stored only as a hash. Only the last 4 characters are shown after creation.
- Only the owner sees or changes hooks.
- An envelope carries reviewers' names and emails to the receiver. Point hooks only at tools you run.
