# One city-level role: City Lead

**Decided 2026-08-17.** The city tier collapses to a single role, **City Lead**,
implemented by the existing `CityHost` table. `City.consulUserId` goes away.

## Why this shape

The naming: "consul" reads as bureaucracy to an audience whose real consulate
experience is visa queues and residence permits — we ship an article called
`residence-permit-first-application` — and it stacked a second metaphor on top
of "city host". "Ambassador" was rejected: marketing has hollowed it out, and it
undersells a role that can programme a whole city. **City Lead** names the job,
which is the convention the rest of the product follows.

The implementation choice was initially planned the other way round (drop
`CityHost`, keep `consulUserId`) on the mistaken belief that `CityHost` was
SQL-only. It is not — it is the *built* one:

| | `CityHost` | `consulUserId` |
|---|---|---|
| admin UI | add + revoke (`app/admin/cities/page.tsx`) | none |
| API routes | `/api/admin/cities/[id]/hosts` | none |
| audit fields | `grantedBy`, `grantedAt`, `revokedAt` | none |
| account-deletion cleanup | yes | no |
| more than one per city | yes | no — single FK |
| public `/hosts` page | already surfaced | no |

So we keep the table and delete the column. Same destination, none of the
rebuilding, and co-leads work without a redesign.

Resulting model — two nouns total:

```
Host       — runs a club and its events   (ClubMembership.role='host')
City Lead  — runs a city                  (CityLead row, was CityHost)
```

Plus `moderator` / `admin`, which are platform roles and not community-facing.

## The table is NOT renamed in the database

`CityHost` already carries `@@map("city_hosts")`, so renaming the **Prisma
model** to `CityLead` is a pure code change with no migration and no risk. Leave
the physical table as `city_hosts` and note why in the schema comment. Renaming
a live table buys tidiness and costs a coordination window; not worth it.

## Order of operations — note this is the INVERSE of the usual rule

CLAUDE.md says migrations lead the code. That is the rule for **adding**: code
that reads a column the DB lacks throws P2022 on every query for the model.

For **dropping** it is the opposite. A column the DB has and the code ignores is
harmless; a column the code reads and the DB lacks is fatal. So the code ships
first and the `DROP` follows.

### 1. Move Serhan's Bodrum appointment into a row (data only, additive)

His lead status currently lives in `cities.consulUserId`. Before the column can
go, it has to exist as a `city_hosts` row:

```sql
INSERT INTO city_hosts ("id","userId","cityId",status,"grantedAt")
SELECT gen_random_uuid()::text, c."consulUserId", c.id, 'approved', now()
  FROM cities c
 WHERE c.slug = 'bodrum' AND c."consulUserId" IS NOT NULL
ON CONFLICT ("userId","cityId") DO NOTHING;
```

Safe at any time — it grants what the column already grants.

### 2. Code change, then deploy

- `prisma/schema.prisma`: model `CityHost` → `CityLead` (keep `@@map("city_hosts")`);
  delete the `consulUserId` field and the `cityHosts`/`cityHostings` relation names
  follow. **Removing a field from the schema while the column still exists is
  safe** — Prisma simply stops selecting it.
- `lib/access.ts`: `isCityHost` → `isCityLead`; delete `isCityConsul` entirely;
  `canHostInCity` drops to two checks (admin, city lead) from three; update the
  cascade comment at :202 and the doc comments at :232 / :254.
- `app/admin/cities/page.tsx` + `/api/admin/cities/[id]/hosts`: relabel Hosts →
  Leads. Consider renaming the route segment to `/leads`; if so, add a redirect.
- `app/hosts/page.tsx`: keep unioning club hosts and city leads. "Meet the Hosts"
  stays the right public framing — a member does not care which grant you hold.
- `app/api/auth/delete-account/route.ts:133`: `tx.cityHost` → `tx.cityLead`.
- `lib/guideContent.ts:6`, `prisma/schema.prisma:406`: comments mentioning consul.

Deploy. Verify any page renders — `getNavCities` runs in the root layout, so the
`cities` model is exercised everywhere.

### 3. Contract — migration, after the above is live

```sql
ALTER TABLE "cities" DROP COLUMN "consulUserId";
```

`prisma migrate deploy`, never `db push`.

## Open decisions

**Does Nate keep Bodrum?** Today's three `city_hosts` rows become the leads:
Nate (Istanbul, Bodrum) and Serhan (İzmir). Adding step 1 makes Serhan a Bodrum
lead too, so Bodrum would have two. Given Serhan runs it and Nate helps, that may
be right — but decide rather than inherit it.

**Club-less city events.** `canCreateEvent` models "city event (no clubId):
admin / city lead", but `app/host/events/new/page.tsx:203` hard-requires a club:
`if (!form.clubId) { setError('Please select a club for this event') }`. That is
why zero of 247 events are city-level — no affordance, not no demand. Bodrum's
grand opening is exactly a city-level event and will have to be filed under a
club regardless. Either build the "no club — city-wide" option gated on City
Lead, or delete the club-less branch server-side so the model stops describing
something the product does not offer.

## Also worth doing in the same pass

**`Role.Host` and `Role.Partner` are dead.** Production is `member 1490 ·
moderator 4 · admin 1` — zero of each. `Role.Host` is actively a trap: it reads
as meaningful, grants nothing, and would not even get you into `/host`, whose
gate checks `isClubHost || admin || moderator`. Delete `Role.Host`. `Role.Partner`
has live code paths (`canManagePartner`), so decide separately.

## Blocked on

The host-gate task (`isCityHost`/`isConsul` on the session payload,
`app/host/layout.tsx` + `app/host/page.tsx`) is editing `lib/access.ts` now.
Let it land and deploy first — it touches the same functions this renames, and
it should be written against `isCityLead` rather than renamed twice.
