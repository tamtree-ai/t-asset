# The Review API

How a tool that makes the work (tamshoot, a pipeline script) puts a version in front of a client and reads back what they said. It is generic: tasset knows clients, projects, assets, versions and comments, and nothing about skits, scenes or StickStage. Design: `planning/2026-11-08-review-loop/01-design.md` §2 in the StickStage planning repo.

Base: `<APP_URL>/api/v1`. JSON in and out. Every call needs `Authorization: Bearer tt_live_…`, a token made in **Settings → API tokens** (shown once; only its hash is kept). A token belongs to one studio and sees nothing outside it.

| Scope | Allows |
|---|---|
| `review:read` | `GET` calls |
| `review:write` | everything else |

Limit: **60 requests a minute per token**; over it is `429` with `Retry-After`.

Errors are `{ "error": "<plain English>", "code": "<stable code>" }`:

| Status | When (codes) |
|---|---|
| 400 | body isn't JSON (`bad_json`), bad `since` (`bad_since`) |
| 401 | no, unknown or revoked token (`unauthorized`) |
| 403 | the token lacks the scope (`forbidden`) |
| 404 | not in this studio (`not_found`) |
| 409 | `externalRef` held by another project (`ref_conflict`) or kind (`kind_conflict`); bytes not uploaded or wrong (`not_uploaded`, `incomplete`, `wrong_type`) |
| 413 | file over the kind's limit (`too_large`) or the studio's storage (`storage_full`) |
| 422 | a field is wrong (`invalid`, `wrong_type`, `file_required`, `built_from_*`, `too_many_variations`), or not built yet (`not_yet`: text assets and versions, document uploads) |
| 429 | rate limit (`rate_limited`) |

## References and retries

`externalRef` is your own name for a thing: up to 200 characters of letters, digits and `_ . : / # -`, e.g. `tamshoot:project/8f2c…/render`. An asset's ref is unique in the studio; a version's is unique in its option. **Creating with a ref that exists returns the existing row** with `200` and `"created": false` (a new one is `201`, `"created": true`), so every create is safe to retry.

## Endpoints

| Method and path | Scope | Does |
|---|---|---|
| `PUT /projects` | write | `{ client, project }` names → `{ projectId, clientId, created }`. Found by name (not archived), or made |
| `PUT /assets` | write | `{ projectId, title, kind: "image" \| "video", externalRef }` → `{ assetId, variationId, created }` ("Main" option) |
| `POST /assets/{assetId}/versions` | write | A new version (below) → `{ versionId, number, status, processing, created, upload? }` |
| `POST /versions/{id}/complete` | write | The bytes are in: checked, handed to Tamtree. Returns the version |
| `POST /versions/{id}/release` | write | Internal → visible to the client. Returns the version |
| `GET /versions/{id}` | read | `{ id, assetId, externalRef, number, status, released, processing, decision, builtFrom }` |
| `GET /versions/{id}/comments?since=` | read | `{ comments: [{ id, number, parentId, author, byStudio, body, annotation, internal, resolved, createdAt }] }` |
| `POST /comments/{id}/replies` | write | `{ body, resolve? }` → `{ id, parentId, resolved }` (201) |

Not in v1: deleting or editing assets, managing review links (the studio sends links from tasset's UI).

### A new version

```json
{
  "externalRef": "render/v2",
  "changeNote": "Shorter line 3",
  "variation": "Main",
  "meta": { "why": "…", "hook": "…", "closing": "…", "durationS": 31.5 },
  "builtFrom": "<version id>  or  { \"externalRef\": \"script/v2\" }",
  "internal": true,
  "file": { "name": "skit.mp4", "contentType": "video/mp4", "bytes": 4823921, "sha256": "…" }
}
```

- `variation` defaults to the asset's first option; a new label makes a new option (up to 6).
- `internal` (default `true`): only the studio sees it until it is released. `false` releases it as soon as `complete` succeeds.
- `builtFrom`: the version this one was made from (the script a render came from). It must be in the same project; by `externalRef` it is looked up across the project's versions.
- `file`: video (`video/mp4`, `video/quicktime`, `video/webm`, `video/x-matroska`, ≤ 500 MB) or image (`image/png`, `image/jpeg`, ≤ 30 MB). The reply carries `upload`, a signed `PUT` valid for 1 hour: send the bytes as the body with exactly `upload.headers`, then call `complete`. Sending the version again before `complete` returns a fresh `upload`.
- After `complete` the file is `pending` until Tamtree has made its previews (the [Tamtree contract](tamtree-contract.md)), then `ready`. **Images through the API go to Tamtree too** (the owner's browser makes an uploaded image's renditions; the API has no browser), so they need a Tamtree flow that handles images, or `pnpm fake-tamtree` in development.
- Documents (PDF) can't be sent through the API yet: their proofs are made in the owner's browser. Text versions arrive with the `text` kind.
- A version whose bytes never arrive is removed with its file by the daily cleanup after 24 hours.

### `decision` and `status`

`status` is `in_review`, `changes_requested` or `approved`, following the latest sign-off. `decision` is that sign-off: `{ kind, by, at, note }`, or `null`.

### Comments

Roots carry `number` (#n in the room) and `annotation` (`{ v: 1, shape: "pin" | "rect" | "time", x, y, w?, h?, t?, tEnd?, frame?, page? }`, normalised 0..1, times in seconds). Replies carry `parentId`. `internal: true` comments are the studio's own and were never shown to the client. Hidden comments are left out. `since` is an ISO time: only comments made after it come back, so pass the newest `createdAt` you have.

A reply is posted under the studio's name. A reply to a reply lands on its thread's root. `"resolve": true` also resolves the thread ("Changed in v2").

## Example

```sh
T=tt_live_…; A=http://localhost:3000/api/v1
H=(-H "authorization: Bearer $T" -H "content-type: application/json")

P=$(curl -s -X PUT $A/projects "${H[@]}" -d '{"client":"Acme","project":"Spring skits"}' | jq -r .projectId)
S=$(curl -s -X PUT $A/assets "${H[@]}" -d "{\"projectId\":\"$P\",\"title\":\"Skit 1\",\"kind\":\"video\",\"externalRef\":\"demo:skit-1/render\"}" | jq -r .assetId)

V=$(curl -s -X POST $A/assets/$S/versions "${H[@]}" \
  -d "{\"externalRef\":\"render/v1\",\"changeNote\":\"First cut\",\"file\":{\"name\":\"skit.mp4\",\"contentType\":\"video/mp4\",\"bytes\":$(stat -f%z skit.mp4)}}")
URL=$(jq -r .upload.url <<<"$V"); ID=$(jq -r .versionId <<<"$V")
curl -s -X PUT "$URL" $(jq -r '.upload.headers | to_entries[] | "-H\n\(.key): \(.value)"' <<<"$V") --data-binary @skit.mp4
curl -s -X POST $A/versions/$ID/complete "${H[@]}"
curl -s -X POST $A/versions/$ID/release "${H[@]}"

curl -s "$A/versions/$ID/comments" "${H[@]}" | jq '.comments[] | {number, author, body}'
curl -s -X POST $A/comments/<commentId>/replies "${H[@]}" -d '{"body":"Changed in v2","resolve":true}'
```
