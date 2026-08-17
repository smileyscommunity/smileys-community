# Rename: city consul → City Lead

**Decided 2026-08-17.** The middle tier of the hosting cascade is renamed from
"consul" to **City Lead**.

Why: the term is user-facing nowhere yet, so it is free to change now and
expensive later. "Consul" reads as bureaucracy to an audience whose real
consulate experience is visa queues and residence permits — we ship an article
called `residence-permit-first-application` — and it stacks a second metaphor on
top of "city host". "Ambassador" was rejected: marketing has hollowed it out,
and it undersells a role that can create city-wide events. "City Lead" names the
job, which is the convention the rest of the product already follows.

Resulting cascade:

```
admin  →  City Lead (appointed lead for the city)  →  city host (granted operational hosting)
```

## DO NOT do this as a straight rename

`getNavCities` runs in the **root layout**, so every page in the app reads the
`cities` table. Prisma selects every column in a model, so a bare
`RENAME COLUMN` has no safe ordering:

- migration first → running code selects `consulUserId`, which no longer exists
  → P2022 on every page, site-wide.
- code first → new code selects `leadUserId`, which does not exist yet → same.

Unlike `events.soldOut` (which would have broken the events pages), this one
takes down **everything**. Use expand/contract.

## Sequence

**Blocked on:** the host-gate task (`isCityHost`/`isConsul` on the session
payload, `app/host/layout.tsx` + `app/host/page.tsx`). It is editing
`lib/access.ts` right now and will collide. Let it land and deploy first.

### 1. Expand — migration A

```sql
ALTER TABLE "cities" ADD COLUMN "leadUserId" TEXT;
UPDATE "cities" SET "leadUserId" = "consulUserId" WHERE "consulUserId" IS NOT NULL;
ALTER TABLE "cities"
  ADD CONSTRAINT "cities_leadUserId_fkey"
  FOREIGN KEY ("leadUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

Backfill in the same transaction as the DDL — the lesson from
`20260816000003_testimonial_city`, where a `db push` created the column and
silently skipped the `UPDATE` that was the entire point of the migration.

Apply with `prisma migrate deploy`. Never `db push`.

At this point both columns exist and agree. Nothing is broken in either
direction, so there is no coordination window.

### 2. Switch the code

`prisma/schema.prisma` keeps **both** fields for this step, so the running code
and the new code are each valid against the database.

- `lib/access.ts` — `isCityConsul` → `isCityLead`; the cascade comment at :202;
  `canHostInCity` at :242; the doc comments at :232 and :254.
- `lib/guideContent.ts:6` — comment.
- `prisma/schema.prisma:406` — comment.
- `docs/multi-city-audit.md:21`.

Deploy. Verify a City query still resolves on a page that hits the root layout
(i.e. any page at all).

### 3. Contract — migration B

```sql
ALTER TABLE "cities" DROP COLUMN "consulUserId";
```

Remove the field from `schema.prisma` in the same change, and deploy.

## Also worth fixing while in here

**There is no UI to appoint a City Lead.** `consulUserId` appears in no admin
page and no admin API route — the only way to set one is SQL against prod, which
is how Bodrum's was set on 2026-08-17. A field on the admin city editor would
mean the next appointment doesn't need a database session.

## Current data

| city | lead |
|---|---|
| bodrum | Serhan Baykan (`cmsp1qg1d01nllp6ffaulukaj`) |
| all others | none |
