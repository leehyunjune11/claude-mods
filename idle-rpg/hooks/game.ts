import type {
  IdleRpgJob as Job,
  IdleRpgJobLine as JobLine,
  IdleRpgRarity as Rarity,
  IdleRpgSave as Save,
  IdleRpgSkillId as SkillId,
  IdleRpgSlot as Slot,
  IdleRpgTier as Tier,
} from '../types'

export const KILLS_PER_STAGE = 10
export const MAX_SKILL = 5
export const GACHA_COST = 300
const GACHA_REFUND = 90
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
/** The 전직 시험관 has this many times the stage boss's hp, fixed when the hero applies. */
const EXAM_HP = 3
/** A 계열 변경 costs what the next this many 강화 would. */
const LINE_CHANGE_ENHANCES = 20

export const SLOTS = ['weapon', 'armor', 'ring'] as const
export const JOB_LINES = ['melee', 'magic', 'ranged', 'rogue'] as const
export const SKILLS = ['flurry', 'crit', 'greed'] as const
export const SLOT_NAMES: Record<Slot, string> = { weapon: '무기', armor: '갑옷', ring: '반지' }
export const SLOT_EFFECTS: Record<Slot, string> = { weapon: '공격력', armor: '골드', ring: '경험치' }
export const RARITY_NAMES = ['없음', '일반', '희귀', '영웅', '전설'] as const
export const SKILL_NAMES: Record<SkillId, string> = { flurry: '연속베기', crit: '급소찌르기', greed: '황금손' }
export const MOB_NAMES = [
  '세미콜론 벌레',
  '널 유령',
  '무한루프 뱀',
  '메모리 누수 방울',
  '스파게티 덩굴',
  '경고 두꺼비',
  '타임아웃 박쥐',
  '길 잃은 구름',
  '세그폴트 불꽃',
  '데드락 바위게',
] as const
/** Stages to a zone: each has its own monsters (MOB_NAMES's) and sky; past the last they come round. */
export const ZONE_STAGES = 25
export const ZONES = [
  { name: '레거시 숲', mobs: [0, 1, 2, 3] },
  { name: '스파게티 늪', mobs: [4, 5, 3] },
  { name: '클라우드 고원', mobs: [6, 7, 1] },
  { name: '커널 화산', mobs: [8, 9, 2] },
] as const
export const BOSS_NAME = '레거시 골렘'
export const EXAM_NAME = '전직 시험관'
export const INTERN = '인턴'

/** The level each tier opens at, 1차 to 3차; and what every line's tier does to attack. */
export const TIER_LEVEL = [0, 10, 30, 60] as const
const TIER_ATTACK = [1, 1.3, 1.7, 2.5] as const

type Trait = { toolHit: number; exp: number; autoMs: number; crit: number; gold: number }
/** What a hero with no trait of a kind has: an 인턴, or a line that trains another. */
const PLAIN: Trait = { toolHit: 3, exp: 1, autoMs: 1500, crit: 0, gold: 1 }

/**
 * The four lines: their names at 1차, 2차 and 3차, and the trait each trains, by tier 0 to 3. `crit` is
 * percentage points added to 급소찌르기's chance.
 */
export const JOBS: Record<JobLine, { label: string; names: readonly [string, string, string]; traits: Partial<Record<keyof Trait, readonly number[]>> }> = {
  melee: { label: '근접', names: ['디버거 기사', '리팩터 나이트', '아키텍트'], traits: { toolHit: [3, 4, 5, 6] } },
  magic: { label: '마법', names: ['스크립트 마법사', '컴파일러 메이지', '커널 대마법사'], traits: { exp: [1, 1.2, 1.4, 1.7] } },
  ranged: { label: '원거리', names: ['API 궁수', '웹훅 스나이퍼', '분산 저격수'], traits: { autoMs: [1500, 1250, 1050, 850] } },
  rogue: { label: '암살', names: ['핫픽스 도적', '제로데이 어쌔신', '루트킷 섀도우'], traits: { crit: [0, 8, 15, 25], gold: [1, 1.15, 1.3, 1.5] } },
}

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
/** `exam`: the hit fell on the 전직 시험관; present only then. */
export type Hit = { dmg: number; crit: boolean; killed: boolean; boss: boolean; advanced: boolean; exam?: true; skill?: JobLine }
export type GameEvent =
  | { type: 'tick'; ms: number }
  | { type: 'tool' }
  | { type: 'exp'; exp: number }
  | { type: 'reward'; exp: number; gold: number }
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

/** The hero's job; a save from before jobs is an 인턴. */
export const jobOf = (save: Save): Job => save.job ?? { line: null, tier: 0, at: 0 }
export const jobName = (job: Pick<Job, 'line' | 'tier'>) => (job.line && JOBS[job.line].names[job.tier - 1]) || INTERN
/** What the hero's job makes of one trait. */
export const trait = (save: Save, key: keyof Trait) => {
  const { line, tier } = jobOf(save)
  return (line && JOBS[line].traits[key]?.[tier]) ?? PLAIN[key]
}
/** Milliseconds between auto attacks. */
export const autoMs = (save: Save) => trait(save, 'autoMs')

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
/** Which of ZONES the hero is in at this kill count. */
export const zoneOf = (kills: number) => Math.floor((stageOf(kills) - 1) / ZONE_STAGES) % ZONES.length
/** Which of MOB_NAMES (and of the sprites) stands at this kill count, bosses aside: the zone's, in turn. */
export const mobIndex = (kills: number) => {
  const { mobs } = ZONES[zoneOf(kills)] ?? ZONES[0]
  return mobs[(stageOf(kills) - 1 + (kills % KILLS_PER_STAGE)) % mobs.length] ?? 0
}

export const gearMult = (save: Save, slot: Slot) => GEAR_MULT[slot][save.gear[slot]] ?? 1
export const attack = (save: Save) =>
  Math.round((8 + 2 * levelOf(save.exp)) * ENHANCE_ATTACK ** save.enhance * gearMult(save, 'weapon') * TIER_ATTACK[jobOf(save).tier])

const stageHp = (save: Save) => MOB_HP * HP_GROWTH ** (stageOf(save.kills) - 1)
/** What a stage's plain monster pays, before gear, skills and job. */
const stageReward = (save: Save) => REWARD_GROWTH ** (stageOf(save.kills) - 1)
/** The attack the pending 전직 시험관 asks for before it steps out; 0 with none pending. */
export const examNeed = (save: Save) => {
  const { trial } = jobOf(save)
  return trial ? Math.ceil(trial.hp / BOSS_TRIES) : 0
}

/**
 * Who the hero faces. A stage's 10th kill is its boss, but the boss waits until the hero could fell
 * it in BOSS_TRIES hits: until then the stage's monsters keep coming, for gold and exp and no
 * ground, so a hero short of attack still earns the gold that buys it. `need` is the attack the
 * waiting boss asks for.
 */
export const foeOf = (save: Save) => {
  // A pending 전직 시험관 steps in front of the stage once the hero could fell it in BOSS_TRIES hits.
  const { trial } = jobOf(save)
  if (trial && attack(save) >= examNeed(save)) return { boss: false, exam: true, need: 0, hp: trial.hp, name: EXAM_NAME }
  const hp = stageHp(save)
  const need = isBoss(save.kills) ? Math.ceil((hp * BOSS_HP) / BOSS_TRIES) : 0
  const boss = need > 0 && attack(save) >= need
  return {
    boss,
    exam: false,
    need: boss ? 0 : need,
    hp: Math.round(hp * (boss ? BOSS_HP : 1)),
    name: boss ? BOSS_NAME : (MOB_NAMES[mobIndex(save.kills)] ?? ''),
  }
}
export const skillPoints = (save: Save) =>
  Math.max(0, levelOf(save.exp) - 1 - SKILLS.reduce((sum, id) => sum + save.skills[id], 0))
/**
 * What a finished to-do worth `xp` pays: half a percent of this level's exp per xp, and half a plain
 * monster's gold of this stage per xp; the magic line's exp and the rogue's gold, and the armor, count.
 */
export const questReward = (save: Save, xp: number) => ({
  exp: Math.round(expNeed(levelOf(save.exp)) * 0.005 * xp * trait(save, 'exp')),
  gold: Math.round(MOB_GOLD * stageReward(save) * (xp / 2) * trait(save, 'gold') * gearMult(save, 'armor')),
})

const costAt = (enhance: number) => Math.round(50 * ENHANCE_COST ** enhance)
export const enhanceCost = (save: Save) => costAt(save.enhance)
/** What a 계열 변경 costs: the next LINE_CHANGE_ENHANCES 강화 together. */
export const lineChangeCost = (save: Save) =>
  Array.from({ length: LINE_CHANGE_ENHANCES }, (_, i) => costAt(save.enhance + i)).reduce((sum, n) => sum + n, 0)
/** The pending trial's examiner hp, were the hero to apply now: EXAM_HP stage bosses. */
const examHp = (save: Save) => Math.round(stageHp(save) * BOSS_HP * EXAM_HP)

const strike = (s: Save, times: number, rng: Rng, now: number): { save: Save; hit: Hit } => {
  const crit = rng() < CRIT_CHANCE * s.skills.crit + trait(s, 'crit') / 100
  const dmg = Math.round(attack(s) * times * (crit ? CRIT_HIT : 1))
  const { boss, exam, need, hp } = foeOf(s)
  const tag = exam ? { exam: true as const } : {}
  // The examiner stands apart from the stage: felling it moves the job on, not the hero.
  const advanced = need === 0 && !exam
  // A merge can leave more damage than the monster now standing has hp: it then falls to this hit.
  if (s.dmg + dmg < hp) return { save: { ...s, dmg: s.dmg + dmg }, hit: { dmg, crit, killed: false, boss, advanced: false, ...tag } }
  const reward = stageReward(s) * (boss || exam ? BOSS_REWARD : 1)
  const job = jobOf(s)
  return {
    save: {
      ...s,
      dmg: 0,
      kills: s.kills + (advanced ? 1 : 0),
      gold: s.gold + Math.round(MOB_GOLD * reward * gearMult(s, 'armor') * (1 + GREED_GOLD * s.skills.greed) * trait(s, 'gold')),
      exp: s.exp + Math.round(MOB_EXP * reward * gearMult(s, 'ring') * trait(s, 'exp')),
      ...(exam && job.trial && { job: { line: job.trial.line, tier: (job.tier + 1) as Tier, at: Math.max(now, job.at + 1) } }),
    },
    hit: { dmg, crit, killed: true, boss, advanced, ...tag },
  }
}

/** An auto attack is the line's own skill this often, from 1차 on. */
export const ACTIVE_CHANCE = 0.05
/** What the skill strikes for, in attacks, by tier. */
export const ACTIVE_POWER = [0, 5, 8, 12] as const
/** Each line's skill: the same strength, its own look and name. */
export const ACTIVE_NAMES: Record<JobLine, string> = {
  melee: '브레이크포인트 베기',
  magic: '컴파일 폭발',
  ranged: '병렬 화살비',
  rogue: '핫픽스 난도질',
}

/**
 * Auto attacks over `ms`, one each `autoMs` of the save as it stands at that attack (a 전직 mid-way
 * changes the pace), and the time short of the next: the caller carries it.
 */
export const autoAttack = (save: Save, ms: number, rng: Rng, now = 0) => {
  const hits: Hit[] = []
  let s = save
  let left = ms
  for (let step = autoMs(s); left >= step; step = autoMs(s)) {
    left -= step
    const { line, tier } = jobOf(s)
    const skill = line !== null && rng() < ACTIVE_CHANCE ? line : undefined
    const struck = strike(s, skill ? ACTIVE_POWER[tier] : 1, rng, now)
    s = struck.save
    hits.push(skill ? { ...struck.hit, skill } : struck.hit)
  }
  return { save: s, hits, left }
}

/** The one way the game moves: time passing, a tool call, money spent. `now` stamps a 전직. */
export const apply = (save: Save, event: GameEvent, rng: Rng, now = 0): { save: Save; hits: Hit[] } => {
  if (event.type === 'exp') return { save: { ...save, exp: save.exp + event.exp }, hits: [] }
  if (event.type === 'reward') return { save: { ...save, exp: save.exp + event.exp, gold: save.gold + event.gold }, hits: [] }
  if (event.type === 'tick') {
    const { save: s, hits } = autoAttack(save, event.ms, rng, now)
    return { save: s, hits }
  }
  const count = 1 + (rng() < FLURRY_CHANCE * save.skills.flurry ? 1 : 0)
  const hits: Hit[] = []
  let s = save
  for (let i = 0; i < count; i++) {
    const struck = strike(s, trait(s, 'toolHit'), rng, now)
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

/** One 강화, or with `max` as many as the gold buys, `keep` gold left over. */
export const enhance = (save: Save, max = false, keep = 0): Purchase => {
  let s = save
  while (s.gold - enhanceCost(s) >= keep && (max || s === save)) s = { ...s, gold: s.gold - enhanceCost(s), enhance: s.enhance + 1 }
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

const lineByName = (name: string) =>
  JOB_LINES.find(line => line === name || JOBS[line].label === name || JOBS[line].names.includes(name))
const lineList = () => JOB_LINES.map(line => JOBS[line].label).join(', ')

/**
 * 전직 신청: from the next tier's level, sets the 전직 시험 with its examiner's hp fixed now, so it
 * does not run away as the stage climbs. An 인턴 names the line; a hero with one keeps it.
 */
export const applyJob = (save: Save, name: string, now: number): Purchase => {
  const job = jobOf(save)
  if (job.tier >= 3) return { refused: `이미 3차 전직까지 마쳤어요 (${jobName(job)}).` }
  if (job.trial) return { refused: `이미 전직 시험 중이에요. ${EXAM_NAME}은 공격력 ${examNeed(save)}부터 나와요.` }
  const need = TIER_LEVEL[job.tier + 1] ?? Infinity
  if (levelOf(save.exp) < need) return { refused: `${job.tier + 1}차 전직은 Lv.${need}부터예요 (지금 Lv.${levelOf(save.exp)}).` }
  const line = job.line ?? (name ? lineByName(name) : undefined)
  if (!line) return { refused: `계열을 골라 주세요: ${lineList()}` }
  if (name && job.line && lineByName(name) !== job.line) {
    return { refused: `${job.tier + 1}차 전직은 지금 계열(${JOBS[job.line].label})로 해요. 계열을 바꾸려면 /rpg 계열 <이름>.` }
  }
  const trial = { line, hp: examHp(save) }
  return {
    save: { ...save, job: { ...job, trial, at: now } },
    note: `${job.tier + 1}차 전직 시험 신청! ${EXAM_NAME}(HP ${trial.hp})을 쓰러뜨리면 ${jobName({ line, tier: (job.tier + 1) as Tier })}이(가) 돼요.`,
  }
}

/** 계열 변경: another line at the same tier, for gold; never mid-trial, never for an 인턴. */
export const changeLine = (save: Save, name: string, now: number): Purchase => {
  const job = jobOf(save)
  const line = lineByName(name)
  if (!job.line) return { refused: '계열 변경은 1차 전직 뒤에 할 수 있어요. 먼저 /rpg 전직 <계열>.' }
  if (job.trial) return { refused: '전직 시험 중에는 계열을 바꿀 수 없어요.' }
  if (!line) return { refused: `바꿀 계열을 골라 주세요: ${lineList()}` }
  if (line === job.line) return { refused: `이미 ${JOBS[line].label} 계열이에요.` }
  const cost = lineChangeCost(save)
  if (save.gold < cost) return { refused: `골드가 부족해요. 계열 변경에는 ${cost}골드가 필요해요 (보유 ${Math.floor(save.gold)}).` }
  const next = { ...job, line, at: now }
  return { save: { ...save, gold: save.gold - cost, job: next }, note: `계열 변경! 이제 ${jobName(next)}.` }
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

/** The job two rows hold, as one: the higher tier, then the later change. Never field by field. */
const joinJob = (a?: Job, b?: Job) => {
  if (!a || !b) return a ?? b
  return b.tier > a.tier || (b.tier === a.tier && b.at > a.at) ? b : a
}

/**
 * Two shares as one: counters add, gear keeps the better piece, the position is the furthest, the
 * job the higher.
 */
export const join = (a: Save, b: Save): Save => {
  const far = b.kills > a.kills || (b.kills === a.kills && b.dmg > a.dmg) ? b : a
  const job = joinJob(a.job, b.job)
  return {
    v: 1,
    exp: a.exp + b.exp,
    gold: a.gold + b.gold,
    kills: far.kills,
    enhance: a.enhance + b.enhance,
    gear: perSlot(slot => Math.max(a.gear[slot], b.gear[slot]) as Rarity),
    skills: perSkill(id => a.skills[id] + b.skills[id]),
    dmg: far.dmg,
    ...(job && { job }),
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

const isLine = (x: unknown): x is JobLine => JOB_LINES.includes(x as JobLine)

/** A stored job, or undefined when it is not one. */
const parseJob = (raw: unknown): Job | undefined => {
  if (!isRecord(raw)) return undefined
  const { line, tier, at, trial } = raw
  if (!isWhole(tier, 3) || !isCount(at) || (tier === 0 ? line !== null : !isLine(line))) return undefined
  if (trial === undefined) return { line, tier, at } as Job
  if (!isRecord(trial) || !isLine(trial.line) || !isCount(trial.hp) || trial.hp === 0 || tier === 3) return undefined
  if (tier > 0 && trial.line !== line) return undefined
  return { line, tier, at, trial: { line: trial.line, hp: trial.hp } } as Job
}

/** What `$.store.get` returned, as a share; anything else counts for nothing. A bad job is dropped alone. */
export const parseSave = (raw: unknown): Save => {
  if (!isRecord(raw) || raw.v !== 1) return fresh()
  const { exp, gold, kills, enhance, dmg, gear, skills } = raw
  const isShare = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x)
  if (typeof exp !== 'number' || typeof gold !== 'number' || !Number.isFinite(exp) || !Number.isFinite(gold)) return fresh()
  if (!isWhole(kills) || !isShare(enhance) || !isCount(dmg) || !isRecord(gear) || !isRecord(skills)) return fresh()
  if (!SLOTS.every(slot => isWhole(gear[slot], 4)) || !SKILLS.every(id => isShare(skills[id]))) return fresh()
  // A save from before exp was whole may hold a fraction.
  const job = parseJob(raw.job)
  return {
    v: 1,
    exp: Math.round(exp),
    gold: Math.round(gold),
    kills,
    enhance,
    dmg,
    gear: perSlot(slot => gear[slot] as Rarity),
    skills: perSkill(id => skills[id] as number),
    ...(job && { job }),
  }
}
