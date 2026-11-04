# t-asset

A client review portal for one studio: clients, projects, assets with options and versions, review links with a passcode, pinned comments on images and video frames, and approvals with a sign-off record. It runs on Vercel's free (Hobby) plan, using Neon Postgres and a private Vercel Blob store. It does no media processing: **Tamtree** makes the previews, thumbnails and watermarks (see [docs/tamtree-contract.md](docs/tamtree-contract.md)).

The plan is in `../tamtree_stickstage/planning/2026-10-05-t-asset/plan.md`.

## Run it locally

```bash
pnpm install
pnpm db:up && pnpm db:migrate          # Postgres on 5434
cp .env.example .env.local             # then fill in the values below
pnpm hash-password                     # paste the result into OWNER_PASSWORD_HASH
openssl rand -hex 32                   # STUDIO_SECRET
pnpm dev                               # http://localhost:3000, sign in with OWNER_EMAIL and your password
pnpm fake-tamtree                      # in a second terminal: processes uploads with ffmpeg + sharp
```

Locally, files go to `.blob-data/` and are served by `/api/dev-blob`. Uploads, Tamtree and the room work just as they do against Vercel Blob. Set `TAMTREE_API_TOKEN` in `.env.local`; `fake-tamtree` reads the same file.

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm test   # unit and service tests (they need the dev Postgres)
pnpm test:e2e                              # the whole journey with the fake Tamtree (needs ffmpeg)
pnpm build
```

## Deploy to Vercel

1. Create a Vercel project from this repo.
2. Under **Storage**, add **Neon** from the Marketplace. This sets `DATABASE_URL`.
3. Under **Storage**, add a **Blob** store with access **Private**, and connect it to the project. This sets `BLOB_STORE_ID` and `BLOB_READ_WRITE_TOKEN`.
4. Run the migration against Neon once: `DATABASE_URL=<neon url> pnpm db:migrate`.
5. Set the remaining environment variables from `.env.example`: `APP_URL`, `STUDIO_SECRET`, `OWNER_EMAIL`, `OWNER_PASSWORD_HASH`, `STUDIO_NAME`, `TAMTREE_API_TOKEN`, `TAMTREE_WEBHOOK_URL`, `TAMTREE_WEBHOOK_SECRET` and `CRON_SECRET`. A production deployment refuses to start without them.
6. Deploy. The daily cleanup cron comes from `vercel.json`.

Vercel's Hobby plan is for non-commercial use only. Move to Pro before sending client links for paid work; no code changes.

## Invoices

**Invoices** in the studio header (owner only). Set the business details once under **Invoices → Invoicing settings**: name, ABN, address, logo, GST, bank, terms, and the next number (`PD6326`, say). Then start an invoice from a client or project page, or from the Invoices list.

- Lines are full price; the one discount applies to the whole invoice. The editor warns when a description's count ("4x screens") disagrees with the quantity.
- A draft has no number and follows the current settings. **Issue invoice** takes the next number and keeps a copy of the studio and client details, so a later change (a new address) leaves it as sent. Issued invoices can't be edited: mark them paid, void them (they keep the number) or duplicate them.
- **Print or save as PDF** opens the invoice as a page of its own; Chrome names the PDF "Invoice PD6326".
- A client with invoices can be archived, not deleted.
- Without the app running: `pnpm invoice invoices/PD6326.json` (see [invoices/README.md](invoices/README.md)) renders the same page to PDF.

The plan is in `../tamtree_stickstage/planning/2026-10-08-invoices/plan.md`. The migration is `drizzle/0001_invoices.sql`: run `pnpm db:migrate` against Neon **before** deploying this.

## Limits that matter

| Limit | Value |
|---|---|
| Blob storage on Hobby | 1 GB. Going over blocks Blob for 30 days, so uploads stop at `BLOB_SOFT_CAP_BYTES` (default 900 MB). The meter is in the studio header |
| Upload size | 30 MB per image, 500 MB per video |
| Video originals | Deleted once Tamtree has made the proxy, unless `KEEP_VIDEO_ORIGINALS=1`. Downloads then get the clean 720p preview |
| Signed file URLs | Last 5 minutes. A revoked link stops new URLs at once |
