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
