# Uploads migration — done, one cleanup step left

Commits `605fed3` (uploads out of `public/`) and `e757b2f` (multi-city phase 1)
shipped together on 2026-08-14 as release `e757b2f`. This file records what was
done and the single step still outstanding. Delete it once that step is done.

## Outstanding

`/root/smileys-community/public/uploads` still exists — 566 MB, frozen since the
deploy. It is the rollback copy, kept deliberately, not an oversight. Nothing
reads or writes it any more:

```bash
ssh root@178.105.37.133 'rm -rf /root/smileys-community/public/uploads'
```

Safe whenever you're ready. Everything in it is also in `/root/smileys-uploads`
(verified equal at 4,051 files), it is unreachable over HTTP (nginx 404s
`/app/uploads/`, and the app no longer resolves paths there), and `deploy.sh`
excludes it so it neither ships nor gets wiped.

## What shipped

**Uploads** now resolve through `lib/uploadRoot.ts` / `UPLOAD_DIR`
(`/root/smileys-uploads`), outside `public/` and outside the deploy root. The
gated `app/api/files` route is the only way to read one. Verified on prod after
the deploy:

- A canary file placed only in `/root/smileys-uploads` served 200 through the
  gated route, and the `<cwd>/uploads` fallback path does not exist — so
  `UPLOAD_DIR` is genuinely in effect.
- A live upload through `/api/apply/upload` landed in `/root/smileys-uploads`
  and **not** in `public/uploads`. (Test file deleted.)
- Applicant photo: 403 on the gated route, 404 on the static path.
- A member avatar and the public pages render normally.

Two straggler syncs ran as planned — one file appeared between the first copy
and the deploy, one more during the deploy window. Both caught.

**Multi-city phase 1**: `scripts/backfill-city-ids.sql` ran on prod before the
deploy, then `prisma db push` dropped the temporary defaults and added the FKs
and indexes. Confirmed after: nine tables `NOT NULL` with no default, `posts`
nullable, 14 `cityId` foreign keys, zero nulls.

## If you rebuild the server

Two things live only on the server and `deploy.sh` restores neither:

- `UPLOAD_DIR=/root/smileys-uploads` in `/root/smileys-community/.env`
  (deploy.sh's preflight refuses to deploy without it, so this fails loud).
- The `location ^~ /app/uploads/ { return 404; }` block in
  `/etc/nginx/sites-available/smileys` — belt-and-braces, and it fails *silent*.
  See SECURITY.md invariant 15.

## Local dev

The local Postgres drifted during this work and made `npm run build` log a
`P2022 column does not exist` mid-build. Fixed by running the same SQL script
against the local DB, then `prisma db push --accept-data-loss` (which also
dropped a stale `visitor_announcements.inboundCount` that prod never had). If a
future build logs P2022, that's the same drift: `deploy.sh` only pushes schema
to the remote DB.
