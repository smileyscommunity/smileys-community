import { describe, it, expect } from 'vitest'
import {
  LIFE_STAGES, lifeStage, articlesForStage, populatedStages, includesHighStakes,
  movingTopics, pickNeighborhoods, type StageArticle,
} from '@/lib/relocation'

// The moving hub and the Handbook's life-stage pages only arrange articles a
// city already has. These pin the rules that stop them linking an empty
// stage, inventing a topic, or ranking a neighbourhood on made-up numbers.

const a = (slug: string, category: string, over: Partial<StageArticle> = {}): StageArticle =>
  ({ slug, title: slug.replace(/-/g, ' '), category, cityId: null, ...over })

const ISTANBUL = [
  a('residence-permit-first-application', 'Bureaucracy'),
  a('istanbul-residence-permit-guide', 'Residence & Legal', { cityId: 'ist' }),
  a('istanbul-apartment-hunting-guide', 'Living in Istanbul', { cityId: 'ist' }),
  a('daily-life-little-things', 'Daily Life', { cityId: 'ist' }),
  a('opening-turkish-bank-account', 'Money & Banking'),
  a('sim-card-and-home-internet', 'Mobile & Digital'),
  a('istanbulkart-mastery', 'Getting Around', { cityId: 'ist' }),
  a('healthcare-how-the-system-works', 'Healthcare', { cityId: 'ist' }),
  a('scams-how-to-stay-safe', 'Safety & Emergencies'),
  a('family-life-raising-children', 'Family', { cityId: 'ist' }),
]

describe('life stages', () => {
  it('has the four stages the Handbook links, in order', () => {
    expect(LIFE_STAGES.map(s => s.key)).toEqual(['planning', 'arriving', 'settling', 'urgent'])
    expect(lifeStage('nope')).toBeNull()
  })

  it('files legacy-category articles under the right stage', () => {
    const planning = articlesForStage(lifeStage('planning')!, ISTANBUL, 'ist').map(x => x.slug)
    expect(planning).toContain('residence-permit-first-application')   // 'Bureaucracy' → Residence & Legal
    expect(planning).toContain('istanbul-apartment-hunting-guide')      // 'Living in Istanbul' → Home & Housing
    expect(planning).not.toContain('istanbulkart-mastery')
  })

  it('puts on-topic, city-own articles first', () => {
    // The city's own residence guide beats the national one (same keywords).
    const planning = articlesForStage(lifeStage('planning')!, ISTANBUL, 'ist').map(x => x.slug)
    expect(planning[0]).toBe('istanbul-residence-permit-guide')
    // An off-keyword article sinks below on-keyword ones, city or not.
    const arriving = articlesForStage(lifeStage('arriving')!, [
      a('tipping-etiquette', 'Money & Banking', { cityId: 'ist' }), a('opening-bank-account', 'Money & Banking'),
    ], 'ist').map(x => x.slug)
    expect(arriving).toEqual(['opening-bank-account', 'tipping-etiquette'])
  })

  it('never files one guide under two timeline stages', () => {
    const timeline = LIFE_STAGES.filter(s => s.timeline !== null)
    const seen = timeline.flatMap(s => articlesForStage(s, ISTANBUL, 'ist').map(x => x.slug))
    // Housing is the one deliberate overlap: you choose before you arrive and
    // settle into it after. Everything else sits in exactly one column.
    const dupes = seen.filter((slug, i) => seen.indexOf(slug) !== i && !/apartment|daily-life/.test(slug))
    expect(dupes).toEqual([])
  })

  it('puts arrival first in the first week: airport, phone, transport card, bank', () => {
    const live = [
      a('istanbul-bank-account-guide', 'Money & Banking', { cityId: 'ist', title: 'Opening a Bank Account in Istanbul' }),
      a('istanbulkart-mastery', 'Getting Around', { cityId: 'ist', title: 'Istanbulkart Mastery' }),
      a('sim-card-and-home-internet-in-turkiye', 'Mobile & Digital', { title: 'Getting a SIM Card and Home Internet in Türkiye' }),
      a('opening-turkish-bank-account', 'Money & Banking', { title: 'Opening a Turkish bank account' }),
      a('arriving-in-istanbul', 'Getting Around', { cityId: 'ist', title: 'Arriving in Istanbul: Getting from IST and Sabiha Gökçen into the City' }),
    ]
    expect(articlesForStage(lifeStage('arriving')!, live, 'ist').map(x => x.slug).slice(0, 3))
      .toEqual(['arriving-in-istanbul', 'sim-card-and-home-internet-in-turkiye', 'istanbulkart-mastery'])
  })

  it('leads urgent help with the emergency numbers, not how healthcare works', () => {
    const live = [
      a('healthcare-in-istanbul', 'Healthcare', { cityId: 'ist', title: 'How Healthcare Actually Works in Istanbul' }),
      a('scams-tourist-traps', 'Safety & Emergencies', { title: 'Scams & Tourist Traps in Türkiye: How to stay safe' }),
      a('emergency-numbers-in-turkiye', 'Safety & Emergencies', { title: 'Emergency Numbers in Türkiye: Call 112' }),
    ]
    expect(articlesForStage(lifeStage('urgent')!, live, 'ist').map(x => x.slug))
      .toEqual(['emergency-numbers-in-turkiye', 'scams-tourist-traps', 'healthcare-in-istanbul'])
  })

  it('urgent help is safety and healthcare only', () => {
    expect(articlesForStage(lifeStage('urgent')!, ISTANBUL, 'ist').map(x => x.slug).sort())
      .toEqual(['healthcare-how-the-system-works', 'scams-how-to-stay-safe'])
  })

  it('drops a stage a city has no article for', () => {
    const onlyTransport = [a('kart', 'Getting Around')]
    expect(populatedStages(onlyTransport, 'x').map(s => s.stage.key)).toEqual(['arriving'])
    expect(populatedStages([], 'x')).toEqual([])
  })
})

describe('includesHighStakes', () => {
  it('is true only for the categories the Handbook marks high-stakes', () => {
    expect(includesHighStakes([a('x', 'Getting Around')])).toBe(false)
    expect(includesHighStakes([a('x', 'Getting Around'), a('y', 'Bureaucracy')])).toBe(true)
    expect(includesHighStakes([a('x', 'Healthcare')])).toBe(true)
  })
})

describe('movingTopics', () => {
  it('lists only topics the city has, in move order', () => {
    expect(movingTopics(ISTANBUL).map(t => t.category)).toEqual([
      'Residence & Legal', 'Home & Housing', 'Money & Banking', 'Mobile & Digital',
      'Healthcare', 'Getting Around', 'Safety & Emergencies',
    ])
    expect(movingTopics([a('kart', 'Getting Around')]).map(t => t.category)).toEqual(['Getting Around'])
  })
})

describe('pickNeighborhoods', () => {
  const reg = ['Kadıköy', 'Moda', 'Beşiktaş', 'Şişli'].map(name => ({ name, slug: name.toLowerCase(), emoji: '📍', vibe: null, area: null }))

  it('ranks by members, then events, then registry order', () => {
    const picks = pickNeighborhoods(reg, new Map([['Moda', 5], ['Şişli', 5]]), new Map([['Şişli', 2]]), 3)
    expect(picks.map(p => p.name)).toEqual(['Şişli', 'Moda', 'Kadıköy'])
    expect(picks[0]).toMatchObject({ members: 5, events: 2 })
  })

  it('still offers a young city its registry, with zero counts rather than invented ones', () => {
    const picks = pickNeighborhoods(reg, new Map(), new Map(), 2)
    expect(picks.map(p => [p.name, p.members, p.events])).toEqual([['Kadıköy', 0, 0], ['Moda', 0, 0]])
  })
})
