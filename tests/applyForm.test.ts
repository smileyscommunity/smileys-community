import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The apply form went from five steps to three on 2026-09-08: the review
// approves 98% of applications in minutes, so the essays and the "difficult
// social situation" prompt screened nobody and cost every applicant ten
// minutes. What replaced them is structured — time in the city, why they
// came, what they hope to find — because the app can match on chips and
// never could on prose. And when a friend sent them, we ask who.
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const form = read('app/apply/ApplyClient.tsx')
const api  = read('app/api/apply/route.ts')
const approve = read('app/api/admin/applications/route.ts')
const migration = read('prisma/migrations/20260908000001_application_looking_for_referrer/migration.sql')

describe('the apply form', () => {
  it('has three steps and no essay screening', () => {
    expect(form).toMatch(/const STEPS = \['Basic Info', 'About You', 'Verification'\]/)
    expect(form).not.toMatch(/socialJudgment|Social Judgment|Community Fit|difficult social situation/)
    expect(form).not.toMatch(/step === [34]\b/)
  })

  it('asks the matching questions as chips and "looking for" from the profile\'s own options', () => {
    expect(form).toMatch(/TIME_IN_CITY\.map/)
    expect(form).toMatch(/REASONS_HERE\.map/)
    expect(form).toMatch(/LOOKING_FOR_OPTIONS\.map/)
    expect(form).toMatch(/lookingFor, referredBy: refCode/)
  })

  it('asks who told them when the source is a friend, and sends the name', () => {
    expect(form).toMatch(/form\.source === 'friend' && \(/)
    expect(form).toMatch(/set\('referrerName', e\.target\.value\)/)
  })

  it('no longer promises a 24-hour review it beats by a day', () => {
    expect(form).not.toMatch(/within 24 hours|24–48 hours/)
    expect(form).toMatch(/usually the same day/)
  })
})

describe('the apply API and approval', () => {
  it('accepts the two new fields, keeps only known looking-for values, and stores the referrer only for friend referrals', () => {
    expect(api).toMatch(/lookingFor:\s+z\.array\(z\.string\(\)\.max\(50\)\)\.max\(10\)/)
    expect(api).toMatch(/referrerName:\s+z\.string\(\)\.trim\(\)\.max\(100\)/)
    expect(api).toMatch(/lookingFor\.filter\(v => LOOKING_FOR_VALUES\.has\(v\)\)/)
    expect(api).toMatch(/referrerName: source === 'friend' \? \(referrerName\?\.trim\(\) \|\| null\) : null/)
  })

  it('copies "looking for" onto the member at approval, and the columns exist in a migration', () => {
    expect(approve).toMatch(/lookingFor:\s+application\.lookingFor\s+\?\? \[\]/)
    expect(migration).toMatch(/ADD COLUMN "lookingFor" TEXT\[\]/)
    expect(migration).toMatch(/ADD COLUMN "referrerName" TEXT/)
  })
})
