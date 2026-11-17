import { expect, test } from 'claude-code/testing'

import type { IdleRpgSave as Save } from '../types'
import {
  MOB_NAMES,
  apply,
  applyJob,
  attack,
  autoAttack,
  changeLine,
  costExp,
  enhance,
  enhanceCost,
  examNeed,
  foeOf,
  fresh,
  gacha,
  isBoss,
  join,
  jobOf,
  learn,
  levelOf,
  lineChangeCost,
  questReward,
  parseSave,
  share,
  stageOf,
  total,
} from './game'
import { BOSS, DAY_PALETTE, EXAMINER, FONT, HERO_IDLE, HERO_SWING, LOOKS, MOBS, PALETTE } from './sprites'

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

const LV10 = 6802 // exp at Lv.10
const LV30 = 434284
const as = (line: 'melee' | 'magic' | 'ranged' | 'rogue', tier: 1 | 2 | 3, over: Partial<Save> = {}): Save => ({ ...fresh(), job: { line, tier, at: 0 }, ...over })

test('전직 신청 sets a trial whose examiner stands in front once the hero could fell it, and felling it is the 전직', () => {
  expect((applyJob(having({ exp: LV10 - 1 }), '마법', 5) as { refused: string }).refused).toContain('Lv.10부터')
  expect((applyJob(having({ exp: LV10 }), '', 5) as { refused: string }).refused).toContain('근접, 마법, 원거리, 암살')

  // Stage 1's boss has 200 hp: the examiner 600, pegged there however far the hero then goes.
  const trying = bought(applyJob(having({ exp: LV10, kills: 3 }), '마법', 5))
  expect(jobOf(trying)).toEqual({ line: null, tier: 0, at: 5, trial: { line: 'magic', hp: 600 } })
  expect('refused' in applyJob(trying, '마법', 6)).toBe(true)
  expect(examNeed(trying)).toBe(15)
  expect(foeOf(trying)).toMatchObject({ exam: true, boss: false, hp: 600, name: '전직 시험관' })

  const { save, hits } = apply(trying, { type: 'tick', ms: 60_000 }, never, 1000)
  const fell = hits.findIndex(h => h.killed)
  expect(hits[fell]).toEqual({ dmg: 28, crit: false, killed: true, boss: false, advanced: false, exam: true })
  expect(hits.slice(fell + 1).every(h => h.exam === undefined)).toBe(true)
  // Paid as a stage boss, the stage not moved by it; the job moves instead.
  const after = apply(trying, { type: 'tick', ms: 1500 * (fell + 1) }, never, 1000).save
  expect(after).toMatchObject({ kills: 3, dmg: 0, gold: 25, exp: LV10 + 30 })
  expect(jobOf(after)).toEqual({ line: 'magic', tier: 1, at: 1000 })
  expect(save.kills).toBeGreaterThan(3)

  // 2차 keeps the line, and asks Lv.30.
  expect((applyJob(after, '', 9) as { refused: string }).refused).toContain('Lv.30부터')
  const second = bought(applyJob({ ...after, exp: LV30 }, '', 9))
  expect(jobOf(second).trial).toEqual({ line: 'magic', hp: 600 })
  expect('refused' in applyJob({ ...after, exp: LV30 }, '근접', 9)).toBe(true)
  expect('refused' in applyJob(as('rogue', 3, { exp: 1e12 }), '', 9)).toBe(true)
})

test('an examiner the hero cannot fell in 40 hits waits, and the stage goes on', () => {
  const far = bought(applyJob(having({ exp: LV10, kills: 215 }), '근접', 1)) // stage 22: the examiner 19394 hp
  expect(examNeed(far)).toBe(485)
  expect(foeOf(far)).toEqual(foeOf(having({ exp: LV10, kills: 215 })))
  expect(foeOf(far).exam).toBe(false)
  const hour = apply(far, { type: 'tick', ms: 600_000 }, never).save
  expect(hour.gold).toBeGreaterThan(0)
  expect(jobOf(hour).trial?.hp).toBe(19394)
})

test('each line trains its trait, and every tier raises attack', () => {
  expect([0, 1, 2, 3].map(tier => attack(tier ? as('magic', tier as 1) : fresh()))).toEqual([10, 13, 17, 25])

  // 근접: a tool call strikes 4x at 1차 (the 인턴's 3x), on attack 13.
  expect(apply(as('melee', 1), { type: 'tool' }, never).hits[0]?.dmg).toBe(52)
  expect(apply(as('magic', 1), { type: 'tool' }, never).hits[0]?.dmg).toBe(39)

  // 마법: exp x1.2 from a kill.
  const kill = (x: Save) => apply({ ...x, dmg: 24 }, { type: 'tick', ms: 1500 }, never).save
  expect(kill(as('magic', 1)).exp).toBe(7) // 6 x 1.2
  expect(kill(as('melee', 1)).exp).toBe(6)

  // 원거리: an auto attack each 1250ms at 1차, the rest carried.
  expect(autoAttack(as('ranged', 1), 2600, never)).toMatchObject({ left: 100 })
  expect(autoAttack(as('ranged', 1), 2600, never).hits.length).toBe(2)
  expect(autoAttack(fresh(), 2600, never)).toMatchObject({ left: 1100 })
  expect(autoAttack(as('ranged', 3), 2600, never).hits.length).toBe(3)

  // 암살: +8%p crit with no 급소찌르기, and gold x1.15.
  expect(apply(as('rogue', 1), { type: 'tick', ms: 1500 }, () => 0.07).hits[0]?.crit).toBe(true)
  expect(apply(as('rogue', 1), { type: 'tick', ms: 1500 }, () => 0.09).hits[0]?.crit).toBe(false)
  expect(apply(fresh(), { type: 'tick', ms: 1500 }, () => 0.07).hits[0]?.crit).toBe(false)
  expect(kill(as('rogue', 3)).gold).toBe(8) // 5 x 1.5, rounded
  expect(kill(as('ranged', 3)).gold).toBe(5)
})

test('계열 변경 keeps the tier and costs the next 20 강화', () => {
  expect(lineChangeCost(fresh())).toBe(2867)
  // One 강화 on, the window slides: the first price leaves, the 21st comes in.
  expect(lineChangeCost(having({ enhance: 1 }))).toBe(2867 - 50 + enhanceCost(having({ enhance: 20 })))
  const refusal = (x: Save, name: string) => (changeLine(x, name, 9) as { refused: string }).refused
  expect(refusal(having({ gold: 1e6 }), '마법')).toContain('1차 전직 뒤에')
  expect(refusal(as('melee', 2, { gold: 1e6, job: { line: 'melee', tier: 2, at: 0, trial: { line: 'melee', hp: 9 } } }), '마법')).toContain('시험 중')
  expect(refusal(as('melee', 2, { gold: 1e6 }), '근접')).toContain('이미 근접')
  expect(refusal(as('melee', 2, { gold: 1e6 }), '바드')).toContain('근접, 마법, 원거리, 암살')
  expect(refusal(as('melee', 2, { gold: 2866 }), '마법')).toContain('2867골드')

  const changed = bought(changeLine(as('melee', 2, { gold: 3000 }), '컴파일러 메이지', 9))
  expect(changed.gold).toBe(133)
  expect(jobOf(changed)).toEqual({ line: 'magic', tier: 2, at: 9 })
})

test('a hero who idles and spends all gold on 강화 passes each 전직 within 3 simulated hours', () => {
  const MINUTE = 60_000
  // Idle a minute at a time, buying all the 강화 the gold allows: the laziest play there is.
  const idleUntil = (start: Save, done: (x: Save) => boolean) => {
    let x = start
    let ms = 0
    while (!done(x) && ms < 24 * 3_600_000) {
      x = apply(x, { type: 'tick', ms: MINUTE }, never, ms).save
      const more = enhance(x, true)
      if (!('refused' in more)) x = more.save
      ms += MINUTE
    }
    return { x, hours: ms / 3_600_000 }
  }
  const pass = (start: Save, line: string) => {
    const tier = jobOf(start).tier
    return idleUntil(bought(applyJob(start, line, 0)), x => jobOf(x).tier > tier)
  }

  const lv10 = idleUntil(fresh(), x => levelOf(x.exp) >= 10).x
  const first = pass(lv10, '원거리')
  expect(first.hours).toBeLessThan(3) // measured: 0.07h (4 minutes), from stage 22
  // The live hero: stage 22, Lv.26, never a 강화, no gold to start with.
  const live = pass(having({ exp: 202825, kills: 219 }), '근접')
  expect(live.hours).toBeLessThan(3) // measured: 0.18h
  const second = pass(idleUntil(first.x, x => levelOf(x.exp) >= 30).x, '')
  expect(second.hours).toBeLessThan(3) // measured: 0.37h
  const third = pass(idleUntil(second.x, x => levelOf(x.exp) >= 60).x, '')
  expect(third.hours).toBeLessThan(3) // measured: 1.38h
  expect(jobOf(third.x)).toMatchObject({ line: 'ranged', tier: 3 })
})

test('13 looks: the 인턴 and each line at 1차 to 3차, two standing frames and two of an attack, each its own', () => {
  expect(Object.keys(LOOKS).sort()).toEqual(['intern', ...['melee', 'magic', 'ranged', 'rogue'].flatMap(line => [1, 2, 3].map(t => `${line}${t}`))].sort())
  for (const [id, look] of Object.entries(LOOKS)) {
    expect([id, look.idle.length, look.swing.length]).toEqual([id, 2, 2])
    for (const rows of [...look.idle, ...look.swing]) {
      expect(rows.length).toBeLessThanOrEqual(9)
      expect(new Set(rows.map(row => row.length)).size).toBe(1)
      for (const c of rows.join('')) expect(c === '.' || PALETTE[c] !== undefined).toBe(true)
    }
    for (const c of Object.keys(look.colors)) expect(PALETTE[c]).toBeDefined()
  }
  // No two looks the same: a tier shows in its colors, its cape or its crown.
  const drawn = Object.values(LOOKS).map(look => JSON.stringify([look.idle, look.swing, { ...PALETTE, ...look.colors }]))
  expect(new Set(drawn).size).toBe(13)
  // A tier up draws more: 2차 a cape, 3차 a crown or aura besides.
  for (const line of ['melee', 'magic', 'ranged', 'rogue']) {
    const has = (tier: number, c: string) => (LOOKS[`${line}${tier}`]?.idle[0] ?? []).join('').includes(c)
    expect([1, 2, 3].map(t => [has(t, 'Q'), has(t, 'X')])).toEqual([[false, false], [true, false], [true, true]])
  }
  expect(EXAMINER.length).toBeLessThanOrEqual(9)
  expect(new Set(EXAMINER.map(row => row.length)).size).toBe(1)
  for (const c of EXAMINER.join('')) expect(c === '.' || PALETTE[c] !== undefined).toBe(true)
  for (const c of Object.keys(DAY_PALETTE)) expect(PALETTE[c]).toBeDefined()
})

test('a quest pays by its xp, the level and the stage, the magic line more exp and the rogue more gold', () => {
  // Lv.1 needs 300 exp: 10 xp is 15 exp. Stage 1's plain monster pays 5 gold: 10 xp is 25.
  expect(questReward(fresh(), 10)).toEqual({ exp: 15, gold: 25 })
  expect(questReward(as('magic', 3), 10)).toEqual({ exp: 26, gold: 25 }) // 15 x 1.7
  expect(questReward(as('rogue', 3, { gear: { weapon: 0, armor: 4, ring: 0 } }), 10)).toEqual({ exp: 15, gold: 94 }) // 25 x 1.5 x 2.5
  expect(apply(fresh(), { type: 'reward', exp: 15, gold: 25 }, never).save).toMatchObject({ exp: 15, gold: 25 })
})
