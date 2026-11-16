import type {
  IdleRpgRarity as Rarity,
  IdleRpgSave as Save,
  IdleRpgSkillId as SkillId,
  IdleRpgSlot as Slot,
} from '../types'

export const AUTO_MS = 1500
export const KILLS_PER_STAGE = 10
export const MAX_SKILL = 5
export const GACHA_COST = 300
const GACHA_REFUND = 90
const TOOL_HIT = 3
const CRIT_HIT = 2.5
const CRIT_CHANCE = 0.05
const FLURRY_CHANCE = 0.15
const GREED_GOLD = 0.1
// Each 강화 multiplies attack and its price alike. A stage asks 18% more attack and pays 12% more
// gold, so the gold a stage costs outgrows what it pays by 5%: progress slows and never stops,
// and never runs away. Cheaper than about 1.07 a step and it would.
const ENHANCE_ATTACK = 1.1
const ENHANCE_COST = 1.1
export const EXP_PER_USD = 1000
const MOB_HP = 25
const MOB_GOLD = 5
const MOB_EXP = 6
const HP_GROWTH = 1.18
const REWARD_GROWTH = 1.12
const BOSS_HP = 8
const BOSS_REWARD = 5
/** The boss steps out once this many plain hits would fell it. */
const BOSS_TRIES = 40

export const SLOTS = ['weapon', 'armor', 'ring'] as const
export const SKILLS = ['flurry', 'crit', 'greed'] as const
export const SLOT_NAMES: Record<Slot, string> = { weapon: '무기', armor: '갑옷', ring: '반지' }
export const SLOT_EFFECTS: Record<Slot, string> = { weapon: '공격력', armor: '골드', ring: '경험치' }
export const RARITY_NAMES = ['없음', '일반', '희귀', '영웅', '전설'] as const
export const SKILL_NAMES: Record<SkillId, string> = { flurry: '연속베기', crit: '급소찌르기', greed: '황금손' }
export const MOB_NAMES = ['세미콜론 벌레', '널 유령', '무한루프 뱀', '메모리 누수 방울'] as const
export const BOSS_NAME = '레거시 골렘'

/** By rarity: what the weapon does to attack, the armor to gold, the ring to exp. */
export const GEAR_MULT: Record<Slot, readonly number[]> = {
  weapon: [1, 1.25, 1.6, 2.2, 3.5],
  armor: [1, 1.15, 1.35, 1.7, 2.5],
  ring: [1, 1.15, 1.35, 1.7, 2.5],
}
/** Where each rarity's share ends: 60 / 28 / 10 / 2. */
const RARITY_EDGES = [0.6, 0.88, 0.98]

export type Rng = () => number
/** `advanced`: the kill moved the hero on; one made while the boss waits does not. */
export type Hit = { dmg: number; crit: boolean; killed: boolean; boss: boolean; advanced: boolean }
export type GameEvent = { type: 'tick'; ms: number } | { type: 'tool' } | { type: 'exp'; exp: number }
export type Purchase = { save: Save; note: string } | { refused: string }

const perSlot = <T>(f: (slot: Slot) => T): Record<Slot, T> => ({ weapon: f('weapon'), armor: f('armor'), ring: f('ring') })
const perSkill = <T>(f: (id: SkillId) => T): Record<SkillId, T> => ({ flurry: f('flurry'), crit: f('crit'), greed: f('greed') })

export const fresh = (): Save => ({
  v: 1,
  exp: 0,
  gold: 0,
  kills: 0,
  enhance: 0,
  gear: perSlot(() => 0),
  skills: perSkill(() => 0),
  dmg: 0,
})

const expNeed = (level: number) => Math.round(300 * 1.22 ** (level - 1))

/** The level `exp` buys, how far into it, and what the next one takes. */
export const levelInfo = (exp: number) => {
  let level = 1
  let into = exp
  for (let need = expNeed(level); into >= need; need = expNeed(level)) {
    into -= need
    level++
  }
  return { level, into, need: expNeed(level) }
}
export const levelOf = (exp: number) => levelInfo(exp).level
export const stageOf = (kills: number) => Math.floor(kills / KILLS_PER_STAGE) + 1
export const isBoss = (kills: number) => kills % KILLS_PER_STAGE === KILLS_PER_STAGE - 1
/** Which of MOB_NAMES (and of the sprites) stands at this kill count, bosses aside. */
export const mobIndex = (kills: number) => (stageOf(kills) - 1 + (kills % KILLS_PER_STAGE)) % MOB_NAMES.length

export const gearMult = (save: Save, slot: Slot) => GEAR_MULT[slot][save.gear[slot]] ?? 1
export const attack = (save: Save) =>
  Math.round((8 + 2 * levelOf(save.exp)) * ENHANCE_ATTACK ** save.enhance * gearMult(save, 'weapon'))

/**
 * Who the hero faces. A stage's 10th kill is its boss, but the boss waits until the hero could fell
 * it in BOSS_TRIES hits: until then the stage's monsters keep coming, for gold and exp and no
 * ground, so a hero short of attack still earns the gold that buys it. `need` is the attack the
 * waiting boss asks for.
 */
export const foeOf = (save: Save) => {
  const hp = MOB_HP * HP_GROWTH ** (stageOf(save.kills) - 1)
  const need = isBoss(save.kills) ? Math.ceil((hp * BOSS_HP) / BOSS_TRIES) : 0
  const boss = need > 0 && attack(save) >= need
  return {
    boss,
    need: boss ? 0 : need,
    hp: Math.round(hp * (boss ? BOSS_HP : 1)),
    name: boss ? BOSS_NAME : (MOB_NAMES[mobIndex(save.kills)] ?? ''),
  }
}
export const skillPoints = (save: Save) =>
  Math.max(0, levelOf(save.exp) - 1 - SKILLS.reduce((sum, id) => sum + save.skills[id], 0))
export const enhanceCost = (save: Save) => Math.round(50 * ENHANCE_COST ** save.enhance)

const strike = (s: Save, times: number, rng: Rng): { save: Save; hit: Hit } => {
  const crit = rng() < CRIT_CHANCE * s.skills.crit
  const dmg = Math.round(attack(s) * times * (crit ? CRIT_HIT : 1))
  const { boss, need, hp } = foeOf(s)
  const advanced = need === 0
  // A merge can leave more damage than the monster now standing has hp: it then falls to this hit.
  if (s.dmg + dmg < hp) return { save: { ...s, dmg: s.dmg + dmg }, hit: { dmg, crit, killed: false, boss, advanced: false } }
  const reward = REWARD_GROWTH ** (stageOf(s.kills) - 1) * (boss ? BOSS_REWARD : 1)
  return {
    save: {
      ...s,
      dmg: 0,
      kills: s.kills + (advanced ? 1 : 0),
      gold: s.gold + Math.round(MOB_GOLD * reward * gearMult(s, 'armor') * (1 + GREED_GOLD * s.skills.greed)),
      exp: s.exp + Math.round(MOB_EXP * reward * gearMult(s, 'ring')),
    },
    hit: { dmg, crit, killed: true, boss, advanced },
  }
}

/** The one way the game moves: time passing, a tool call, money spent. */
export const apply = (save: Save, event: GameEvent, rng: Rng): { save: Save; hits: Hit[] } => {
  if (event.type === 'exp') return { save: { ...save, exp: save.exp + event.exp }, hits: [] }
  const isTool = event.type === 'tool'
  const count = isTool ? 1 + (rng() < FLURRY_CHANCE * save.skills.flurry ? 1 : 0) : Math.floor(event.ms / AUTO_MS)
  const hits: Hit[] = []
  let s = save
  for (let i = 0; i < count; i++) {
    const struck = strike(s, isTool ? TOOL_HIT : 1, rng)
    s = struck.save
    hits.push(struck.hit)
  }
  return { save: s, hits }
}

/**
 * Whole exp from a cumulative bill at `rate` exp a dollar, and the bill it is paid up to: what is
 * short of one exp stays owed, so small bills add up and exp stays whole. A bill never seen, or one
 * lower than the last (another session's, after a resume), only re-seeds.
 */
export const costExp = (lastUsd: number | undefined, usd: number, rate: number) => {
  if (lastUsd === undefined || usd < lastUsd) return { exp: 0, lastUsd: usd }
  // 4.1 - 4 is 0.0999...: the sliver keeps a round spend a round exp.
  const exp = Math.floor((usd - lastUsd) * rate + 1e-6)
  return { exp, lastUsd: exp === 0 ? lastUsd : Math.min(usd, lastUsd + exp / rate) }
}

/** One 강화, or with `max` as many as the gold buys. */
export const enhance = (save: Save, max = false): Purchase => {
  let s = save
  while (s.gold >= enhanceCost(s) && (max || s === save)) s = { ...s, gold: s.gold - enhanceCost(s), enhance: s.enhance + 1 }
  if (s === save) {
    return { refused: `골드가 부족해요. 강화에는 ${enhanceCost(save)}골드가 필요해요 (보유 ${Math.floor(save.gold)}).` }
  }
  return { save: s, note: `강화 +${s.enhance} 성공!` }
}

export const gacha = (save: Save, rng: Rng): Purchase => {
  if (save.gold < GACHA_COST) {
    return { refused: `골드가 부족해요. 뽑기에는 ${GACHA_COST}골드가 필요해요 (보유 ${Math.floor(save.gold)}).` }
  }
  const slot = SLOTS[Math.min(SLOTS.length - 1, Math.floor(rng() * SLOTS.length))] ?? 'weapon'
  const roll = rng()
  const rarity = (1 + RARITY_EDGES.filter(edge => roll >= edge).length) as Rarity
  const drawn = `뽑기 결과: ${RARITY_NAMES[rarity]} ${SLOT_NAMES[slot]}.`
  if (rarity <= save.gear[slot]) {
    return {
      save: { ...save, gold: save.gold - GACHA_COST + GACHA_REFUND },
      note: `${drawn} 지금 장비(${RARITY_NAMES[save.gear[slot]]})보다 좋지 않아 ${GACHA_REFUND}골드를 돌려받았어요.`,
    }
  }
  return {
    save: { ...save, gold: save.gold - GACHA_COST, gear: { ...save.gear, [slot]: rarity } },
    note: `${drawn} 장착했어요! ${SLOT_EFFECTS[slot]} x${GEAR_MULT[slot][rarity]}`,
  }
}

export const learn = (save: Save, id: SkillId): Purchase => {
  const level = save.skills[id]
  if (level >= MAX_SKILL) return { refused: `${SKILL_NAMES[id]}은(는) 이미 최고 레벨이에요.` }
  if (skillPoints(save) < 1) return { refused: '스킬 포인트가 없어요. 레벨이 오를 때마다 1씩 생겨요.' }
  return { save: { ...save, skills: { ...save.skills, [id]: level + 1 } }, note: `${SKILL_NAMES[id]} Lv.${level + 1}` }
}

/**
 * Sessions keep a row each in the store, and never write another's. A row is a save whose exp, gold,
 * 강화 and skills are that session's own share (its gold below zero when it spent what others
 * earned), beside its own position and gear.
 */

/** Two shares as one: counters add, gear keeps the better piece, the position is the furthest. */
export const join = (a: Save, b: Save): Save => {
  const far = b.kills > a.kills || (b.kills === a.kills && b.dmg > a.dmg) ? b : a
  return {
    v: 1,
    exp: a.exp + b.exp,
    gold: a.gold + b.gold,
    kills: far.kills,
    enhance: a.enhance + b.enhance,
    gear: perSlot(slot => Math.max(a.gear[slot], b.gear[slot]) as Rarity),
    skills: perSkill(id => a.skills[id] + b.skills[id]),
    dmg: far.dmg,
  }
}

/** This session's row: what its save holds past `rest`, everyone else's shares joined. */
export const share = (mine: Save, rest: Save): Save => ({
  ...mine,
  exp: mine.exp - rest.exp,
  gold: mine.gold - rest.gold,
  enhance: mine.enhance - rest.enhance,
  skills: perSkill(id => mine.skills[id] - rest.skills[id]),
})

/** The save to play on: every share joined, held to what a save may be. */
export const total = (rest: Save, own: Save): Save => {
  const all = join(rest, own)
  return {
    ...all,
    // Whole, though a session reloaded over a save from before exp was whole brings a fraction.
    exp: Math.max(0, Math.round(all.exp)),
    gold: Math.max(0, all.gold),
    enhance: Math.max(0, all.enhance),
    skills: perSkill(id => Math.min(MAX_SKILL, Math.max(0, all.skills[id]))),
  }
}

const isCount = (x: unknown, max = Infinity): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max
const isWhole = (x: unknown, max = Infinity): x is number => isCount(x, max) && Number.isInteger(x)
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null

/** What `$.store.get` returned, as a share; anything else counts for nothing. */
export const parseSave = (raw: unknown): Save => {
  if (!isRecord(raw) || raw.v !== 1) return fresh()
  const { exp, gold, kills, enhance, dmg, gear, skills } = raw
  const isShare = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x)
  if (typeof exp !== 'number' || typeof gold !== 'number' || !Number.isFinite(exp) || !Number.isFinite(gold)) return fresh()
  if (!isWhole(kills) || !isShare(enhance) || !isCount(dmg) || !isRecord(gear) || !isRecord(skills)) return fresh()
  if (!SLOTS.every(slot => isWhole(gear[slot], 4)) || !SKILLS.every(id => isShare(skills[id]))) return fresh()
  // A save from before exp was whole may hold a fraction.
  return { v: 1, exp: Math.round(exp), gold: Math.round(gold), kills, enhance, dmg, gear: perSlot(slot => gear[slot] as Rarity), skills: perSkill(id => skills[id] as number) }
}
