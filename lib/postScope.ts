import { Prisma } from '@prisma/client'

// Who sees which post, in one place.
//
// A post carries two location columns and the pair means three different
// things (see Post.country in schema.prisma):
//
//   cityId set                → city-local   (Başkentkart, İzmirim Kart)
//   cityId null, country 'TR' → national     (residence permit, SIM cards)
//   cityId null, country null → global       (most community posts)
//
// Before `country` existed, "national" and "global" were the same row shape,
// which was invisibly correct while every Smileys city was in Türkiye and
// becomes wrong the day one isn't: a member in Athens would be handed the
// Turkish residence-permit guide as if it applied to them.
//
// Six read paths filter on this — the Handbook index, a category page, an
// article's related list, two dashboard shelves, the weekly digest and search.
// They had six copies of the same OR clause, so this is the one definition;
// a seventh caller gets it right by importing rather than by remembering.
//
// NOTE this is a LISTING scope, not access control. A direct link to any
// article still opens for anyone — an indexed URL must not start 404ing based
// on a cookie (see the comment on getHandbookRelated). What it decides is what
// a city RECOMMENDS and lists.

/**
 * Prisma `where` fragment: posts visible to a reader in this city.
 *
 * Spread into an existing where, don't nest it — `{ kind, ...postCityScope() }`
 * keeps the OR at the top level where Prisma ANDs it with the rest.
 */
export function postCityScope(cityId: string, country: string | null) {
  return {
    OR: [
      { cityId },                                    // this city's own
      { cityId: null, country },                     // national, same country
      { cityId: null, country: null },               // genuinely global
    ],
  }
}

/**
 * The same rule as a SQL fragment, for the one caller on raw SQL (search).
 *
 * Kept beside the Prisma version deliberately: two spellings of one rule drift
 * unless they sit in the same file and are read together.
 */
export function postCityScopeSql(cityId: string, country: string | null): Prisma.Sql {
  return Prisma.sql`(
    "cityId" = ${cityId}
    OR ("cityId" IS NULL AND ("country" IS NULL OR "country" = ${country}))
  )`
}
