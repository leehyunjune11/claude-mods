import { expect, test } from 'claude-code/testing'

import type { IdleRpgSave as Save } from '../types'
import {
  ACTIVE_NAMES,
  ACTIVE_POWER,
  MOB_NAMES,
  apply,
  applyJob,
  attack,
  autoAttack,
  autoMs,
  dungeon,
  petGacha,
  petPower,
  PET_COST,
  MAX_PET_LEVEL,
  critChance,
  changeLine,
  costExp,
  enhance,
  enhanceCost,
  autoEnhance,
  challenge,
  challengeNow,
  foeOf,
  fresh,
  gacha,
  isBoss,
  MAX_FORGE, gearMult, join,
  jobOf,
  learn,
  levelOf,
  lineChangeCost,
  maxHp,
  dayStart,
  missionProgress,
  STAGE_MS,
  questReward,
  parseSave,
  share,
  stageOf,
  total,
} from './game'
import { PETS, BOSS, BOSS_STEP, DAY_PALETTE, EXAMINER, FONT, HERO_IDLE, HERO_SWING, LOOKS, MOB_STEPS, MOBS, PALETTE, TINTS } from './sprites'

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
  expect(apply(fresh(), { type: 'tick', ms: 1499 }, never)).toEqual({ save: fresh(), hits: [], fails: [] })
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

test('the boss always steps out; a hero too weak for the stage falls, laps the stage before it, and tries again', () => {
  const stuck = having({ kills: 205 }) // stage 21: 10 attack and 100 hp against 685-hp monsters
  expect(foeOf(stuck)).toMatchObject({ boss: false, hp: 685 })
  expect(foeOf(having({ kills: 219 }))).toMatchObject({ boss: true, name: '레거시 골렘' })

  const fell = apply(stuck, { type: 'tick', ms: 30_000 }, never, 7)
  expect(fell.fails).toContain('fall')
  // Back at the start of stage 20 with full hp and a fresh clock, a lap to run; nothing lost.
  let back = stuck
  for (let fails: string[] = []; fails.length === 0; ) ({ save: back, fails } = apply(back, { type: 'tick', ms: 1500 }, never, 7))
  expect(back).toMatchObject({ kills: 190, lap: 10, hurt: 0, ms: 0, dmg: 0, best: 205, moved: 7 })

  // An hour of it pays, and never takes the hero past the wall.
  const hour = apply(stuck, { type: 'tick', ms: 3_600_000 }, never)
  expect(stageOf(hour.save.best)).toBe(21)
  expect(hour.save.gold).toBeGreaterThan(1000)

  // Grown enough, the next challenge clears the wall.
  const ready = autoEnhance({ ...hour.save, gold: 1e9 })
  expect(challenge(ready).ms).toBeLessThan(STAGE_MS)
  expect(challenge(ready).hurt).toBeLessThan(maxHp(ready))
  expect(stageOf(apply(ready, { type: 'tick', ms: 3_600_000 }, never).save.best)).toBeGreaterThan(21)
})

test('a challenge the clock runs out on falls back too, but a retreat lap has no clock', () => {
  // Hp to spare and too little attack: stage 21 takes far past the limit.
  const slow = having({ kills: 200, vit: 200 })
  const timed = apply(slow, { type: 'tick', ms: STAGE_MS + 1500 }, never)
  expect(timed.fails).toEqual(['time'])
  expect(timed.save).toMatchObject({ kills: 190, lap: 10 })

  // The same hero runs its lap of stage 20 to the end, however long, and is back at stage 21.
  let x = timed.save
  for (let i = 0; i < 200 && x.lap > 0; i++) {
    const next = apply(x, { type: 'tick', ms: 60_000 }, never)
    expect(next.fails).toEqual([])
    x = next.save
  }
  expect(x).toMatchObject({ kills: 200, lap: 0 })
})

test('a lap the hero falls in runs again, one more stage back if it made no kill; stage 1 is fought again, with nothing lost', () => {
  const lapping = having({ kills: 195, lap: 5, hurt: 99, ms: 1000 })
  const again = apply(lapping, { type: 'tick', ms: 1500 }, never)
  expect(again.fails).toEqual(['lap'])
  expect(again.save).toMatchObject({ kills: 190, lap: 10, hurt: 0 })
  const bare = apply(having({ kills: 190, lap: 10, hurt: 99, ms: 1000 }), { type: 'tick', ms: 1500 }, never)
  expect(bare.fails).toEqual(['lap'])
  expect(bare.save).toMatchObject({ kills: 180, lap: 10 })

  const first = apply(having({ kills: 4, hurt: 99, gold: 40, ms: 1500 }), { type: 'tick', ms: 1500 }, never)
  expect(first.fails).toEqual(['fall'])
  expect(first.save).toMatchObject({ kills: 0, lap: 0, gold: 40 })
})

test("the day's stage mission counts the furthest stage, so a retreat and its retry count nothing", () => {
  // The day began mid-lap at stage 9, stage 10 already reached; back on 10 is no new ground.
  const from = dayStart(having({ kills: 85, lap: 5, best: 95 }))
  expect(missionProgress('stage', having({ kills: 95, best: 95 }), from)).toBe(0)
  expect(missionProgress('stage', having({ kills: 100, best: 105 }), from)).toBe(1)
  expect(dayStart(having({ enhance: 3, vit: 4 })).enhance).toBe(7)
})

test('a new stage starts with full hp and a fresh clock, and the furthest reach only climbs', () => {
  const { save } = apply(having({ kills: 9, dmg: 195, hurt: 50, ms: 40_000, best: 9 }), { type: 'tick', ms: 1500 }, never)
  expect(save).toMatchObject({ kills: 10, hurt: 0, ms: 0, best: 10 })
  expect(maxHp(fresh())).toBe(100)
  expect(maxHp(having({ exp: LV10, vit: 2 }))).toBe(Math.round(190 * 1.21))
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

  // No better than what is worn: 합성, a level on the slot and its effect.
  const worse = bought(gacha({ ...legend, gold: 300 }, rolls(0, 0.1)))
  expect(worse.gear.weapon).toBe(4)
  expect(worse.gold).toBe(0)
  expect(worse.forge).toEqual({ weapon: 1, armor: 0, ring: 0 })
  expect(Math.abs(gearMult(worse, 'weapon') - gearMult(legend, 'weapon') * 1.05)).toBeLessThan(1e-9)
  // At the top 합성 level it pays some gold back instead.
  const capped = bought(gacha({ ...legend, gold: 300, forge: { weapon: MAX_FORGE, armor: 0, ring: 0 } }, rolls(0, 0.1)))
  expect([capped.gold, capped.forge?.weapon]).toEqual([90, MAX_FORGE])

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

test('shares join: counters add, gear keeps the better piece, the latest position wins whole', () => {
  const rest = having({ gold: 180, kills: 22, exp: 1500, dmg: 99, enhance: 1, gear: { weapon: 1, armor: 2, ring: 0 } })
  const mine = having({ gold: 230, kills: 25, exp: 1600, dmg: 7, enhance: 3, gear: { weapon: 3, armor: 0, ring: 0 } })

  const own = share(mine, rest)
  expect(own).toMatchObject({ gold: 50, exp: 100, enhance: 2, kills: 25, dmg: 7 })
  expect(total(rest, own)).toEqual({ ...mine, gear: { weapon: 3, armor: 2, ring: 0 }, best: 25 })

  // Kills are a place, not a count: two sessions at stage 3 are at stage 3.
  expect(join(having({ kills: 22, dmg: 99 }), having({ kills: 21, dmg: 400 }))).toMatchObject({ kills: 22, dmg: 99 })
  expect(join(having({ kills: 22, dmg: 5 }), having({ kills: 22, dmg: 9 })).dmg).toBe(9)
  // A session that starts fresh takes the position stored, damage dealt included.
  expect(total(having({ kills: 9, dmg: 150 }), share(fresh(), fresh()))).toMatchObject({ kills: 9, dmg: 150 })
  // A row an ended session left further on loses to the one that moved last: a retreat holds.
  const ended = having({ kills: 219, dmg: 806, best: 219, moved: 100 })
  const retreated = having({ kills: 200, lap: 10, best: 219, moved: 200, vit: 3 })
  expect(join(ended, retreated)).toMatchObject({ kills: 200, dmg: 0, lap: 10, moved: 200, best: 219, vit: 3 })
  expect(total(ended, share(retreated, ended))).toMatchObject({ kills: 200, lap: 10, best: 219 })
  expect(total(having({ vit: 2 }), having({ vit: -5 })).vit).toBe(0)
  // A share's gold is below zero when it spent what others earned; the save stops at 0.
  expect(total(having({ gold: 100 }), having({ gold: -30 })).gold).toBe(70)
  expect(total(having({ gold: 10 }), having({ gold: -30 })).gold).toBe(0)
  expect(total(having({ skills: { flurry: 4, crit: 0, greed: 0 } }), having({ skills: { flurry: 3, crit: 0, greed: 0 } })).skills.flurry).toBe(5)
})

test('parseSave takes a stored save and nothing else', () => {
  const good = having({ exp: 12, gold: 40, kills: 13, enhance: 2, dmg: 3, gear: { weapon: 2, armor: 0, ring: 4 }, vit: -1, best: 20, hurt: 7, ms: 900, lap: 3, moved: 5 })
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
  // A row from before the fight, or with a bad fight field, stands where a fresh fight does.
  const { vit, best, hurt, ms, lap, moved, ...old } = good
  expect(parseSave(old)).toEqual({ ...good, vit: 0, best: 13, hurt: 0, ms: 0, lap: 0, moved: 0 })
  expect(parseSave({ ...good, lap: 11, hurt: -1, best: 2 })).toEqual({ ...good, lap: 0, hurt: 0, best: 13 })
})

test('every sprite is a grid of palette colors that fits the scene', () => {
  const sprites = [...HERO_IDLE, ...HERO_SWING, ...MOBS, BOSS, ...MOB_STEPS, BOSS_STEP, ...PETS.slice(1)]
  for (const rows of sprites) {
    expect(rows.length).toBeLessThanOrEqual(9)
    expect(new Set(rows.map(row => row.length)).size).toBe(1)
    for (const c of rows.join('')) expect(c === '.' || PALETTE[c] !== undefined).toBe(true)
  }
  expect(MOBS.length).toBe(MOB_NAMES.length)
  expect(TINTS.length).toBe(MOBS.length + 1)
  // A second frame is its first's size, so the monster stands still on its spot.
  for (const [i, rows] of [...MOBS, BOSS].entries()) {
    const next = [...MOB_STEPS, BOSS_STEP][i] ?? []
    expect([next.length, next[0]?.length]).toEqual([rows.length, rows[0]?.length])
  }
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
  const row = { ...fresh(), gold: 40, kills: 13, best: 13 }
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

test('전직 신청 sets a trial whose examiner steps in at once, and felling it is the 전직', () => {
  expect((applyJob(having({ exp: LV10 - 1 }), '마법', 5) as { refused: string }).refused).toContain('Lv.10부터')
  expect((applyJob(having({ exp: LV10 }), '', 5) as { refused: string }).refused).toContain('근접, 마법, 원거리, 암살')

  // Stage 1's boss has 200 hp: the examiner 600, pegged there however far the hero then goes.
  const trying = bought(applyJob(having({ exp: LV10, kills: 3 }), '마법', 5))
  expect(jobOf(trying)).toEqual({ line: null, tier: 0, at: 5, trial: { line: 'magic', hp: 600 } })
  expect('refused' in applyJob(trying, '마법', 6)).toBe(true)
  expect(foeOf(trying)).toMatchObject({ exam: true, boss: false, hp: 600, name: '전직 시험관' })

  const { save, hits } = apply(trying, { type: 'tick', ms: 60_000 }, never, 1000)
  const fell = hits.findIndex(h => h.killed)
  expect(hits[fell]).toEqual({ dmg: 28, crit: false, killed: true, boss: false, advanced: false, exam: true })
  expect(hits.slice(fell + 1).every(h => h.exam === undefined)).toBe(true)
  // Paid as a stage boss, the stage not moved by it; the job moves instead.
  const after = apply(trying, { type: 'tick', ms: 1500 * (fell + 1) }, never, 1000).save
  expect(after).toMatchObject({ kills: 3, dmg: 0, gold: 25, exp: LV10 + 30, hurt: 0, ms: 0 })
  expect(jobOf(after)).toEqual({ line: 'magic', tier: 1, at: 1000 })
  expect(save.kills).toBeGreaterThan(3)

  // 2차 keeps the line, and asks Lv.30.
  expect((applyJob(after, '', 9) as { refused: string }).refused).toContain('Lv.30부터')
  const second = bought(applyJob({ ...after, exp: LV30 }, '', 9))
  expect(jobOf(second).trial).toEqual({ line: 'magic', hp: 600 })
  expect('refused' in applyJob({ ...after, exp: LV30 }, '근접', 9)).toBe(true)
  expect('refused' in applyJob(as('rogue', 3, { exp: 1e12 }), '', 9)).toBe(true)
})

test('an examiner too strong falls the hero back a stage for a lap, the trial kept, and steps in again after it', () => {
  const far = bought(applyJob(having({ exp: LV10, kills: 215, dmg: 300 }), '근접', 1)) // stage 22: the examiner 19394 hp
  expect(foeOf(far)).toMatchObject({ exam: true, hp: 19394 })
  expect(far).toMatchObject({ dmg: 0, hurt: 0, ms: 0 })
  const tried = apply(far, { type: 'tick', ms: 20_000 }, never)
  expect(tried.fails).toEqual(['fall'])
  expect(tried.save).toMatchObject({ kills: 200, lap: 10 })
  expect(jobOf(tried.save).trial?.hp).toBe(19394)
  expect(foeOf(tried.save).exam).toBe(false)
  expect(foeOf({ ...tried.save, kills: 210, lap: 0 }).exam).toBe(true)
  // At stage 1 the lap is of stage 1 itself, so the hero still earns between tries.
  const early = bought(applyJob(having({ exp: LV10, kills: 2 }), '근접', 1))
  const lapped = apply({ ...early, job: { ...jobOf(early), trial: { line: 'melee', hp: 1e9 } } }, { type: 'tick', ms: STAGE_MS }, never).save
  expect(lapped).toMatchObject({ kills: 0, lap: 10 })
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

test('a hero who idles with 자동 강화 passes each 전직 within 3 simulated hours', () => {
  const MINUTE = 60_000
  // Idle a minute at a time, buying all the 강화 the gold allows: the laziest play there is.
  const idleUntil = (start: Save, done: (x: Save) => boolean) => {
    let x = start
    let ms = 0
    while (!done(x) && ms < 24 * 3_600_000) {
      x = apply(x, { type: 'tick', ms: MINUTE }, never, ms).save
      x = autoEnhance(x)
      ms += MINUTE
    }
    return { x, hours: ms / 3_600_000 }
  }
  const pass = (start: Save, line: string) => {
    const tier = jobOf(start).tier
    return idleUntil(bought(applyJob(start, line, 0)), x => jobOf(x).tier > tier)
  }

  const lv10 = idleUntil(fresh(), x => levelOf(x.exp) >= 10).x
  // The live hero: stage 22, Lv.26, never a 강화, no gold to start with. Measured: 0.18h.
  expect(pass(having({ exp: 202825, kills: 219 }), '근접').hours).toBeLessThan(3)
  // Measured, 1차 / 2차 / 3차 in hours: 근접 0.07 / 0.37 / 1.38, 마법 0.07 / 0.28 / 1.20,
  // 원거리 0.07 / 0.30 / 0.97, 암살 0.07 / 0.28 / 0.98 (a fresh Lv.10 stands at stage 22).
  for (const line of ['근접', '마법', '원거리', '암살']) {
    const first = pass(lv10, line)
    const second = pass(idleUntil(first.x, x => levelOf(x.exp) >= 30).x, '')
    const third = pass(idleUntil(second.x, x => levelOf(x.exp) >= 60).x, '')
    expect([line, first.hours < 3, second.hours < 3, third.hours < 3, jobOf(third.x).tier]).toEqual([line, true, true, true, 3])
  }
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

test("an auto attack is now and then the line's skill, from 1차 on, striking for its tier's power", () => {
  const save = as('rogue', 2, { exp: 6802 })
  // The skill's roll, then the crit's: a skill that does not crit.
  const { hits } = autoAttack(save, 1500, rolls(0.01, 0.99))
  expect(hits).toEqual([{ dmg: attack(save) * ACTIVE_POWER[2], crit: false, killed: true, boss: false, advanced: true, skill: 'rogue' }])
  expect(autoAttack(save, 1500, rolls(0.5, 0.99)).hits[0]?.skill).toBeUndefined()
  // The 인턴 has none, however the dice fall.
  expect(autoAttack(fresh(), 1500, () => 0).hits[0]?.skill).toBeUndefined()
  expect(Object.keys(ACTIVE_NAMES).sort()).toEqual(['magic', 'melee', 'ranged', 'rogue'])
})

test('합성 levels join by the higher per slot, and a bad one drops alone', () => {
  const a = { ...fresh(), forge: { weapon: 3, armor: 0, ring: 1 } }
  const b = { ...fresh(), forge: { weapon: 1, armor: 2, ring: 0 } }
  expect(join(a, b).forge).toEqual({ weapon: 3, armor: 2, ring: 1 })
  expect(join(fresh(), fresh()).forge).toBeUndefined()
  expect(parseSave({ ...a, forge: { weapon: -1, armor: 0, ring: 0 } })).toEqual(fresh())
  expect(parseSave({ ...a, kills: 4, forge: 'lots' })).toEqual({ ...fresh(), kills: 4, best: 4 })
  expect(parseSave(a).forge).toEqual(a.forge)
})

test('보스 도전 skips the rest of a lap to where its end would leave the hero, the examiner too', () => {
  expect(challengeNow(having({ kills: 0 }), 1)).toEqual({ refused: expect.stringContaining('반복 사냥 중에만') })
  const lapping = having({ kills: 195, lap: 5, best: 205, hurt: 40, ms: 9000, dmg: 3 })
  const now = bought(challengeNow(lapping, 7))
  expect(now).toMatchObject({ kills: 200, lap: 0, hurt: 0, ms: 0, dmg: 0, best: 205, moved: 7 })
  // A pending trial: the examiner steps in, from stage 1's lap too.
  const trial = { line: 'melee' as const, hp: 1e9 }
  const exam = bought(challengeNow(having({ kills: 0, lap: 10, job: { line: null, tier: 0, trial, at: 1 } }), 2))
  expect(exam.kills).toBe(10)
  expect(foeOf(exam).exam).toBe(true)
})

test('치명타 확률, 치명타 피해 and 공격 속도: each its own price, the two capped, the swing never under 300ms', () => {
  const rich = having({ gold: 1e12 })
  const crit = bought(enhance(rich, true, 0, 'critRate'))
  expect(crit.critRate).toBe(40)
  expect(enhance(crit, false, 0, 'critRate')).toEqual({ refused: expect.stringContaining('이미 최대(+40)') })
  expect(critChance(crit)).toBe(0.4)
  // A sure crit: 2.5x, and 0.1 more for each 치명타 피해.
  const sure = { ...rich, critRate: 100, critDmg: 5 }
  expect(apply(sure, { type: 'tick', ms: 1500 }, rolls(0.5)).hits[0]?.dmg).toBe(Math.round(attack(sure) * 3))
  expect(enhanceCost(rich, 'critDmg')).toBe(200)
  const fast = bought(enhance(rich, true, 0, 'haste'))
  expect(fast.haste).toBe(50)
  expect(autoMs(fast)).toBe(750)
  expect(autoMs({ ...fast, job: { line: 'ranged', tier: 3, at: 0 } })).toBe(425)
  expect(autoMs({ ...fast, haste: 500, job: { line: 'ranged', tier: 3, at: 0 } })).toBe(300)
  // Shares add; two sessions buying at once are held to the cap.
  const a = having({ critRate: 30, haste: 30, critDmg: 4 })
  expect(total(a, a)).toMatchObject({ critRate: 40, haste: 50, critDmg: 8 })
  expect(share(total(a, a), a)).toMatchObject({ critDmg: 4 })
  // A save from before them reads them as none.
  const { critRate, critDmg, haste, ...old } = a
  expect(parseSave(old)).toMatchObject({ critRate: 0, critDmg: 0, haste: 0 })
  expect(dayStart(a).enhance).toBe(64)
})

test('펫 뽑기: a rarer pet comes, one no better levels the kept one, and the pet adds to each auto attack', () => {
  expect(petGacha(having({ gold: 999 }), never)).toEqual({ refused: expect.stringContaining('1000골드') })
  const duck = bought(petGacha(having({ gold: PET_COST * 3 }), rolls(0.1)))
  expect(duck).toMatchObject({ gold: PET_COST * 2, pet: { rarity: 1, level: 0 } })
  expect(petPower(duck)).toBe(0.1)
  const owl = bought(petGacha(duck, rolls(0.99)))
  expect(owl.pet).toEqual({ rarity: 4, level: 0 })
  const leveled = bought(petGacha(owl, rolls(0.1)))
  expect(leveled.pet).toEqual({ rarity: 4, level: 1 })
  expect(Math.round(petPower(leveled) * 100)).toBe(63)
  const full = { ...leveled, gold: PET_COST, pet: { rarity: 4 as const, level: MAX_PET_LEVEL } }
  expect(bought(petGacha(full, rolls(0.1)))).toMatchObject({ gold: 300, pet: { level: MAX_PET_LEVEL } })
  // The pet's share lands with the swing.
  const hit = apply(having({ kills: 9, pet: { rarity: 4, level: 0 } }), { type: 'tick', ms: 1500 }, never).hits[0]
  expect(hit?.dmg).toBe(16)
  // Rows keep the rarer pet, then the higher level; a bad one reads as none.
  expect(join(having({ pet: { rarity: 2, level: 9 } }), having({ pet: { rarity: 3, level: 0 } })).pet).toEqual({ rarity: 3, level: 0 })
  expect(join(having({ pet: { rarity: 3, level: 4 } }), having({})).pet).toEqual({ rarity: 3, level: 4 })
  expect(parseSave(having({ pet: { rarity: 5 as never, level: 0 } })).pet).toBeUndefined()
  expect(parseSave(having({ pet: { rarity: 2, level: 3 } })).pet).toEqual({ rarity: 2, level: 3 })
})

test('a 던전 run fights the furthest stage for a minute or till the hero falls, pays one kind five times over, and leaves the hero be', () => {
  const hero = having({ kills: 0, best: 0 })
  const run = dungeon(hero, 'gold', never)
  // Stage 1: 25 hp, 10 a swing, so a kill each third swing of 1.5s; 40 swings in the minute.
  expect(run).toMatchObject({ kills: 13, ms: 60_000, fell: false, gold: 13 * 5 * 5, exp: 0 })
  expect(dungeon(hero, 'exp', never)).toMatchObject({ gold: 0, exp: 13 * 6 * 5 })
  // Far past its strength, it falls early and is paid for what it felled.
  const weak = dungeon(having({ best: 300 }), 'gold', never)
  expect(weak.fell).toBe(true)
  expect(weak.ms).toBeLessThan(60_000)
  expect(weak.kills).toBe(0)
})
