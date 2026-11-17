import { expect, test } from 'claude-code/testing'

import type { IdleRpgSave as Save } from '../types'
import {
  MOB_NAMES,
  apply,
  attack,
  costExp,
  enhance,
  enhanceCost,
  foeOf,
  fresh,
  gacha,
  isBoss,
  jobOf,
  join,
  learn,
  levelOf,
  parseSave,
  share,
  stageOf,
  total,
} from './game'
import { BOSS, FONT, HERO_IDLE, HERO_SWING, MOBS, PALETTE } from './sprites'

const never = () => 0.99
const rolls = (...values: number[]) => {
  let i = 0
  return () => values[i++] ?? 0.99
}
const having = (over: Partial<Save>): Save => ({ ...fresh(), ...over })
const bought = (p: ReturnType<typeof enhance>) => {
  if ('refused' in p) throw new Error(`refused: ${p.refused}`)
  return p.save
}

test('a stage 1 monster falls to the third auto attack and pays gold and exp', () => {
  const two = apply(fresh(), { type: 'tick', ms: 3000 }, never)
  expect(two.save.kills).toBe(0)
  expect(two.save.dmg).toBe(20)

  const three = apply(fresh(), { type: 'tick', ms: 4500 }, never)
  expect(three.hits.map(h => h.killed)).toEqual([false, false, true])
  expect(three.save).toMatchObject({ kills: 1, gold: 5, exp: 6, dmg: 0 })
})

test('time short of one attack does nothing', () => {
  expect(apply(fresh(), { type: 'tick', ms: 1499 }, never)).toEqual({ save: fresh(), hits: [] })
})

test('ten kills make a stage, and the tenth is a boss with 8x the hp and 5x the reward', () => {
  expect(stageOf(9)).toBe(1)
  expect(stageOf(10)).toBe(2)
  expect(isBoss(8)).toBe(false)
  expect(isBoss(9)).toBe(true)
  expect(foeOf(having({ kills: 8 }))).toMatchObject({ boss: false, hp: 25 })
  expect(foeOf(having({ kills: 9 }))).toMatchObject({ boss: true, hp: 200, name: '레거시 골렘' })

  const { save, hits } = apply(having({ kills: 9, dmg: 195 }), { type: 'tick', ms: 1500 }, never)
  expect(hits).toEqual([{ dmg: 10, crit: false, killed: true, boss: true, advanced: true }])
  expect(save).toMatchObject({ kills: 10, gold: 25, exp: 30 })
  expect(foeOf(save).hp).toBe(30) // 25 x 1.18, rounded
})

test('a boss the hero cannot fell in 40 hits waits: the stage keeps paying, and attack brings it out', () => {
  const stuck = having({ kills: 209 }) // stage 21: the boss has 5479 hp, the hero 10 attack
  expect(foeOf(stuck)).toMatchObject({ boss: false, need: 137, hp: 685 })

  const hour = apply(stuck, { type: 'tick', ms: 3_600_000 }, never)
  expect(hour.save.kills).toBe(209)
  expect(hour.save.gold).toBeGreaterThan(1000)
  expect(hour.hits.filter(h => h.killed).every(h => !h.advanced && !h.boss)).toBe(true)

  const ready = bought(enhance({ ...hour.save, gold: 1e6 }, true))
  expect(attack(ready)).toBeGreaterThanOrEqual(137)
  expect(foeOf(ready)).toMatchObject({ boss: true, need: 0, hp: 5479 })
  expect(apply(ready, { type: 'tick', ms: 3_600_000 }, never).save.kills).toBeGreaterThan(209)
})

test('a tool call strikes 3x, flurry adds a second strike, crit multiplies by 2.5', () => {
  expect(apply(fresh(), { type: 'tool' }, never).hits).toEqual([{ dmg: 30, crit: false, killed: true, boss: false, advanced: true }])

  const skilled = having({ kills: 9, skills: { flurry: 5, crit: 0, greed: 0 } })
  expect(apply(skilled, { type: 'tool' }, () => 0.5).hits.length).toBe(2) // 0.5 < 5 x 15%
  expect(apply(skilled, { type: 'tool' }, () => 0.8).hits.length).toBe(1)

  const sharp = having({ skills: { flurry: 0, crit: 5, greed: 0 } })
  expect(apply(sharp, { type: 'tick', ms: 1500 }, () => 0.2).hits).toEqual([{ dmg: 25, crit: true, killed: true, boss: false, advanced: true }])
  expect(apply(sharp, { type: 'tick', ms: 1500 }, () => 0.3).hits[0]?.crit).toBe(false)
})

test('gear and skills scale attack, gold and exp', () => {
  expect(attack(fresh())).toBe(10)
  expect(attack(having({ enhance: 5, gear: { weapon: 2, armor: 0, ring: 0 } }))).toBe(26) // 10 x 1.1^5 x 1.6

  const rich = having({ dmg: 24, gear: { weapon: 0, armor: 4, ring: 4 }, skills: { flurry: 0, crit: 0, greed: 5 } })
  const { save } = apply(rich, { type: 'tick', ms: 1500 }, never)
  expect(save.gold).toBe(19) // 5 x 2.5 x 1.5 = 18.75
  expect(save.exp).toBe(15) // 6 x 2.5
})

test('a rise in the bill gives whole exp once; a first or lower bill only re-seeds', () => {
  expect(costExp(1, 1.5, 1000)).toEqual({ exp: 500, lastUsd: 1.5 })
  expect(costExp(1.5, 1.5, 1000).exp).toBe(0)
  expect(costExp(undefined, 7, 1000)).toEqual({ exp: 0, lastUsd: 7 })
  expect(costExp(5, 3, 1000)).toEqual({ exp: 0, lastUsd: 3 })
  expect(costExp(0, 1, 1350).exp).toBe(1350) // a rare ring's rate
  expect(apply(fresh(), { type: 'exp', exp: 500 }, never).save.exp).toBe(500)
})

test('ten-cent bills make round exp, and bills short of one exp add up', () => {
  let paid = { exp: 0, lastUsd: 4 as number | undefined }
  let exp = 0
  for (const usd of [4.1, 4.2, 4.3]) {
    paid = costExp(paid.lastUsd, usd, 1000)
    exp += paid.exp
  }
  expect(exp).toBe(300)
  expect(levelOf(exp)).toBe(2)

  paid = { exp: 0, lastUsd: 0 }
  exp = 0
  for (let i = 1; i <= 1000; i++) {
    paid = costExp(paid.lastUsd, i * 0.0002, 1000)
    exp += paid.exp
  }
  expect(exp).toBe(200)
})

test('exp buys levels', () => {
  expect(levelOf(0)).toBe(1)
  expect(levelOf(299)).toBe(1)
  expect(levelOf(300)).toBe(2)
  expect(levelOf(300 + 366)).toBe(3)
})

test('enhance takes its cost, raises attack 10%, and costs 10% more each time', () => {
  expect('refused' in enhance(having({ gold: 49 }))).toBe(true)
  const once = bought(enhance(having({ gold: 50 })))
  expect(once).toMatchObject({ gold: 0, enhance: 1 })
  expect(attack(once)).toBe(11)
  expect(enhanceCost(once)).toBe(55)
  // 50 + 55 + 61 = 166: the gold buys three and no fourth.
  expect(bought(enhance(having({ gold: 200 }), true))).toMatchObject({ gold: 34, enhance: 3 })
})

test('gacha draws the slot and rarity the dice say, and never downgrades', () => {
  expect('refused' in gacha(having({ gold: 299 }), never)).toBe(true)

  const legend = bought(gacha(having({ gold: 300 }), rolls(0, 0.99)))
  expect(legend.gear).toEqual({ weapon: 4, armor: 0, ring: 0 })
  expect(legend.gold).toBe(0)

  const worse = bought(gacha({ ...legend, gold: 300 }, rolls(0, 0.1)))
  expect(worse.gear.weapon).toBe(4)
  expect(worse.gold).toBe(90)

  const rarityAt = (roll: number) => bought(gacha(having({ gold: 300 }), rolls(0.5, roll))).gear.armor
  expect([0, 0.59, 0.6, 0.87, 0.88, 0.97, 0.98].map(rarityAt)).toEqual([1, 1, 2, 2, 3, 3, 4])
  expect(bought(gacha(having({ gold: 300 }), rolls(0.999, 0))).gear.ring).toBe(1)
})

test('a skill costs a point, which a level gives, and stops at 5', () => {
  expect('refused' in learn(fresh(), 'crit')).toBe(true)
  const levelTwo = having({ exp: 300 })
  const learned = bought(learn(levelTwo, 'crit'))
  expect(learned.skills.crit).toBe(1)
  expect('refused' in learn(learned, 'greed')).toBe(true)
  expect('refused' in learn(having({ exp: 1e6, skills: { flurry: 5, crit: 0, greed: 0 } }), 'flurry')).toBe(true)
})

test('shares join: counters add, gear keeps the better piece, the furthest position wins whole', () => {
  const rest = having({ gold: 180, kills: 22, exp: 1500, dmg: 99, enhance: 1, gear: { weapon: 1, armor: 2, ring: 0 } })
  const mine = having({ gold: 230, kills: 25, exp: 1600, dmg: 7, enhance: 3, gear: { weapon: 3, armor: 0, ring: 0 } })

  const own = share(mine, rest)
  expect(own).toMatchObject({ gold: 50, exp: 100, enhance: 2, kills: 25, dmg: 7 })
  expect(total(rest, own)).toEqual({ ...mine, gear: { weapon: 3, armor: 2, ring: 0 } })

  // Kills are a place, not a count: two sessions at stage 3 are at stage 3.
  expect(join(having({ kills: 22, dmg: 99 }), having({ kills: 21, dmg: 400 }))).toMatchObject({ kills: 22, dmg: 99 })
  expect(join(having({ kills: 22, dmg: 5 }), having({ kills: 22, dmg: 9 })).dmg).toBe(9)
  // A session that starts fresh takes the position stored, damage dealt included.
  expect(total(having({ kills: 9, dmg: 150 }), share(fresh(), fresh()))).toMatchObject({ kills: 9, dmg: 150 })
  // A share's gold is below zero when it spent what others earned; the save stops at 0.
  expect(total(having({ gold: 100 }), having({ gold: -30 })).gold).toBe(70)
  expect(total(having({ gold: 10 }), having({ gold: -30 })).gold).toBe(0)
  expect(total(having({ skills: { flurry: 4, crit: 0, greed: 0 } }), having({ skills: { flurry: 3, crit: 0, greed: 0 } })).skills.flurry).toBe(5)
})

test('parseSave takes a stored save and nothing else', () => {
  const good = having({ exp: 12, gold: 40, kills: 13, enhance: 2, dmg: 3, gear: { weapon: 2, armor: 0, ring: 4 } })
  expect(parseSave(JSON.parse(JSON.stringify({ ...good, extra: 'x' })))).toEqual(good)

  const garbage: unknown[] = [
    undefined,
    null,
    'save',
    42,
    [],
    {},
    { ...good, v: 2 },
    { ...good, exp: 'lots' },
    { ...good, gold: null },
    { ...good, gold: 'Infinity' },
    { ...good, kills: 1.5 },
    { ...good, exp: null },
    { ...good, gear: { weapon: 9, armor: 0, ring: 0 } },
    { ...good, gear: { weapon: 1 } },
    { ...good, skills: { flurry: 1.5, crit: 0, greed: 0 } },
    { ...good, skills: undefined },
  ]
  for (const raw of garbage) expect(parseSave(raw)).toEqual(fresh())
  // A share may owe gold, and a save from before exp was whole is rounded.
  expect(parseSave({ ...good, gold: -30, exp: 12.5 })).toEqual({ ...good, gold: -30, exp: 13 })
})

test('every sprite is a grid of palette colors that fits the scene', () => {
  const sprites = [...HERO_IDLE, ...HERO_SWING, ...MOBS, BOSS]
  for (const rows of sprites) {
    expect(rows.length).toBeLessThanOrEqual(9)
    expect(new Set(rows.map(row => row.length)).size).toBe(1)
    for (const c of rows.join('')) expect(c === '.' || PALETTE[c] !== undefined).toBe(true)
  }
  expect(MOBS.length).toBe(MOB_NAMES.length)
  for (const glyph of Object.values(FONT)) expect(glyph.map(row => row.length)).toEqual([3, 3, 3, 3, 3])
})

// The live store the day jobs came in (~/.claude/backups/idle-rpg-store.bak-20261117-pre-job.json):
// the old every-session save, then a row per session, none of them with a job.
const LIVE_STORE: unknown[] = [
  {"v":1,"exp":5185.1945,"gold":3722,"kills":179,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":96},
  {"v":1,"exp":65510,"gold":53909,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":720},
  {"v":1,"exp":2672,"gold":1296,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":374},
  {"v":1,"exp":10,"gold":0,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":578},
  {"v":1,"exp":84,"gold":54,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":578},
  {"v":1,"exp":49273,"gold":38448,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":768},
  {"v":1,"exp":3852,"gold":810,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":578},
  {"v":1,"exp":9,"gold":0,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":768},
  {"v":1,"exp":1605,"gold":594,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":578},
  {"v":1,"exp":34394,"gold":17658,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":768},
  {"v":1,"exp":0,"gold":0,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":768},
  {"v":1,"exp":0,"gold":0,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":768},
  {"v":1,"exp":65,"gold":54,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":768},
  {"v":1,"exp":0,"gold":0,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":768},
  {"v":1,"exp":65,"gold":54,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":768},
  {"v":1,"exp":65,"gold":54,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":768},
  {"v":1,"exp":0,"gold":0,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":768},
  {"v":1,"exp":12997,"gold":8802,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":768},
  {"v":1,"exp":10411,"gold":7290,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":768},
  {"v":1,"exp":8883,"gold":6696,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":768},
  {"v":1,"exp":7669,"gold":5454,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":768},
  {"v":1,"exp":76,"gold":54,"kills":219,"enhance":0,"gear":{"weapon":0,"armor":0,"ring":0},"skills":{"flurry":0,"crit":0,"greed":0},"dmg":768},
]

test('the live store from before jobs reads whole, as an 인턴', () => {
  const rows = LIVE_STORE.map(parseSave)
  expect(rows.every(row => row.job === undefined)).toBe(true)
  const all = total(rows.reduce(join, fresh()), fresh())
  expect(all).toMatchObject({ exp: 202825, gold: 144949, kills: 219, enhance: 0, dmg: 768 })
  expect(levelOf(all.exp)).toBe(26)
  expect(jobOf(all)).toEqual({ line: null, tier: 0, at: 0 })
  // A row written after the change, with a job, joins in without moving anything else.
  const knight = { ...fresh(), job: { line: 'melee', tier: 1, at: 5 } } as const
  expect(total(rows.reduce(join, fresh()), knight)).toMatchObject({ gold: 144949, kills: 219, job: knight.job })
})

test('rows join the job whole: the higher tier, then the later change', () => {
  const job = (tier: 0 | 1 | 2 | 3, at: number, line: 'melee' | 'magic' | null = tier ? 'melee' : null) => ({ ...fresh(), job: { line, tier, at } })
  expect(join(job(1, 100), job(2, 5)).job).toEqual({ line: 'melee', tier: 2, at: 5 })
  expect(join(job(2, 5), job(1, 100)).job).toEqual({ line: 'melee', tier: 2, at: 5 })
  expect(join(job(1, 5), job(1, 9, 'magic')).job).toEqual({ line: 'magic', tier: 1, at: 9 })
  // A trial pending in one row comes with its job, never pasted onto the other's.
  const trying = { ...fresh(), job: { line: null, tier: 0, at: 7, trial: { line: 'rogue', hp: 600 } } } as const
  expect(join(job(0, 3), trying).job).toEqual(trying.job)
  expect(join(trying, job(1, 1)).job).toEqual({ line: 'melee', tier: 1, at: 1 })
  expect(join(fresh(), trying).job).toEqual(trying.job)
  expect('job' in join(fresh(), fresh())).toBe(false)
  // share and total carry it as they carry the position.
  expect(share(trying, fresh()).job).toEqual(trying.job)
})

test('parseSave keeps a good job and drops a bad one alone', () => {
  const row = { ...fresh(), gold: 40, kills: 13 }
  const good = [
    { line: null, tier: 0, at: 0 },
    { line: 'magic', tier: 2, at: 99 },
    { line: null, tier: 0, at: 1, trial: { line: 'ranged', hp: 600 } },
    { line: 'rogue', tier: 1, at: 1, trial: { line: 'rogue', hp: 600 } },
  ]
  for (const job of good) expect(parseSave({ ...row, job })).toEqual({ ...row, job } as Save)
  const bad: unknown[] = [
    'knight',
    { line: 'melee', tier: 0, at: 0 },
    { line: null, tier: 1, at: 0 },
    { line: 'bard', tier: 1, at: 0 },
    { line: 'melee', tier: 4, at: 0 },
    { line: 'melee', tier: 1 },
    { line: 'melee', tier: 1, at: 0, trial: { line: 'magic', hp: 600 } },
    { line: 'melee', tier: 3, at: 0, trial: { line: 'melee', hp: 600 } },
    { line: null, tier: 0, at: 0, trial: { line: 'melee', hp: -1 } },
  ]
  for (const job of bad) expect(parseSave({ ...row, job })).toEqual(row)
})
