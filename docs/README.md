# docs/ — working notes and drafts

Planning notes, audits, and content drafts. Nothing in here is served by the
app or read at runtime — the source of truth for live content is the database
(and, for CMS-managed JSON, the server's `data/` copies; see `data/README.md`).

**Seed-time snapshots:** `izmir-guide-entries.draft.json` and
`antalya-guide-entries.draft.json` are the drafts the city guides were seeded
from. The DB is authoritative — prod entries have been remapped and edited
since, so do not re-seed or diff against these expecting them to match.
Likewise `izmirim-kart-publish-ready.md` and `antalyakart-publish-ready.md`
are marked HISTORICAL: they were published via `scripts/publish-*` and prod
has moved on independently.
