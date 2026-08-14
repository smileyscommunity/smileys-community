# Uploads migration — remaining steps

Commit `605fed3` moved uploads out of `public/` (see `lib/uploadRoot.ts` and
SECURITY.md invariant 15). The code is committed but **not yet deployed**, and
the server is mid-migration. This file lists what's left. Delete it once the
last step is done.

## State as of 2026-08-14

Already done on the server (safe under the currently deployed code, which still
reads `public/uploads` and ignores `UPLOAD_DIR`):

- `/root/smileys-uploads` created and populated — 4,049 files, 566 MB, copied
  (not moved) from `/root/smileys-community/public/uploads`.
- `UPLOAD_DIR=/root/smileys-uploads` appended to `/root/smileys-community/.env`.
  Backup of the previous `.env` at `/root/env-backup-20260814`. Nothing in
  `.env.local` overrides it.
- nginx returns 404 for `/app/uploads/` (commit `990ae13`). That is what's
  actually holding the hole closed right now — the code move is the durable
  version of the same guarantee, not an urgent patch.

Deferred deliberately: the working tree also held an unfinished multi-city
migration, so the uploads deploy waits and ships alongside it.

## The one thing that goes stale

`/root/smileys-uploads` is a **copy taken on 2026-08-14**. Every upload after
that lands in `public/uploads` until the new code ships. So:

**Immediately before the deploy, re-sync stragglers:**

```bash
ssh root@178.105.37.133 \
  'rsync -av /root/smileys-community/public/uploads/ /root/smileys-uploads/'
```

Run it again right after the pm2 restart too — it catches anything uploaded
during the deploy window. It's additive; it never deletes.

## Deploy

Normal `./deploy.sh`, plus the usual rules: fresh DB backup first, explicit
confirmation, never two deploys in parallel. The new preflight (`→ Checking
upload store...`) fails the deploy if `UPLOAD_DIR` is unset, points inside the
deploy root, or doesn't exist.

## Verify after deploy

```bash
# An avatar and an event image must still load through the gated route.
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' \
  "https://smileyscommunity.com/app/api/files/users/<file>"

# An applicant photo must be 403 on the route and 404 on the static path.
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://smileyscommunity.com/app/api/files/applications/<file>"
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://smileyscommunity.com/app/uploads/applications/<file>"
```

Also upload a photo through the app (profile photo is the quickest) and confirm
the new file appears under `/root/smileys-uploads/users/` and **not** under
`public/uploads/`.

## Then, and only then

```bash
ssh root@178.105.37.133 'rm -rf /root/smileys-community/public/uploads'
```

Keep it until the verification above passes — it is the rollback copy. Leave
the nginx 404 block in place regardless; it costs nothing and covers a future
contributor reintroducing a `public/` write path.
