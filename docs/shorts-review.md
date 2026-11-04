# Shorts review

How shorts cut by the pipeline (StickStage `packages/shorts`) are reviewed here. The plan is in
`~/sites/agent-orchestrator/changes/2026-11-04-shorts-service/`.

## Two stages in one room

A version has `released_at`. **Null means internal**: only the studio sees it. Guests never get an
internal version: the room, pinned shares and file routes all read through `loadShareContent`,
which filters them out. An owner's own upload is released at once (the column defaults to now).
A link whose assets hold only drafts tells the client "Your work is on its way", not "ended".

- **Drafts to review** (`/studio/queue`): every internal version, grouped by project, with the
  pipeline's `why`, hook, duration and open notes. Tick and **Release selected to client**: one
  action for the whole batch. A draft with open notes starts unticked.
- **Asset page**: an internal version says so, with **Release to client**, and shows "Why this
  short" from `versions.meta`.
- Comments on an internal version work as usual; they are the notes for the next cut.

## The loop

```bash
# 1. drafts in (each short = a video asset; each run = its next version, internal)
pnpm shorts ingest <work dir> --videos <render dir> --client "<client>" --project "<project>" [--note "what changed"]
# 2. watch at /studio/queue, comment on the exact moment
# 3. the notes out, as JSON with each comment's time on the short's clock
pnpm shorts comments <work dir>
# 4. Claude (StickStage skill `shorts-editor`) re-cuts, renders, and step 1 again with --note
# 5. release in the queue; the client reviews and approves in the same room
```

`pnpm fake-tamtree` (or the real Tamtree flow) must be running to make the previews.
