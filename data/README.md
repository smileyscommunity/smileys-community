# data/ — who owns which file

Two kinds of JSON live here, and mixing them up breaks prod in opposite ways.

## SERVER-authoritative (rsync-excluded — the local copy is a stale seed)

Edited in production via the admin CMS; `deploy.sh` excludes them from rsync,
so the server's copy is the real one and the file in this repo is only the
first-boot seed:

- `announcement.json`
- `member-spotlight.json`
- `settings.json`
- `banners.json`
- `why-content.json`
- `content.json`
- `city-guide.json`
- `neighborhoods/` (whole directory)

## Repo-shipped (deploys overwrite the server copy)

Edited here, in git; every deploy replaces the server's copy:

- `guide-experiences.json`
- `guide-routes.json`

## The two failure modes

1. **Editing a stale local copy does nothing.** Changing a server-authoritative
   file here never reaches prod (rsync skips it) — make the edit in the admin
   CMS, or on the server directly.
2. **Re-including a server file in rsync clobbers prod CMS edits.** Removing
   one of these files from `deploy.sh`'s exclude list makes the next deploy
   overwrite the live CMS content with this repo's stale seed. Check the
   exclude list in `deploy.sh` before moving a file between categories.
3. **Copying the whole local file to the server clobbers CMS-only fields.**
   `scp data/content.json root@…` looks like a safe way to ship a copy edit,
   but the server's copy carries values that exist nowhere in git — the
   landing hero set at /admin/content (`home.heroImage`), for one. On
   2026-09-04 a session did exactly that to ship a digest-slot change (it
   took `/root/content.json.bak-20260904-183827` first, which is how the
   hero was recovered a day later): every share of /app lost its picture.
   Ship a change to one of these files by editing the field on the server
   (a small `python3 -c` that loads, sets the one key, and writes back), or
   in the CMS — never by replacing the file.
