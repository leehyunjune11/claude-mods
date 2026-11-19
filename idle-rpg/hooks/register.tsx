import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { IdleRpgJobLine as JobLine, IdleRpgMeta as Meta, IdleRpgSave as Save, IdleRpgSkillId as SkillId, IdleRpgSlot as Slot } from '../types'
import {
  ACTIVE_NAMES,
  BOSS_NAME,
  EXAM_NAME,
  EXP_PER_USD,
  gachaCost,
  rebirth,
  rebirthBonus,
  rebirthGain,
  rebirthOf,
  REBIRTH_STAGE,
  petCost,
  DUNGEON_MS,
  DUNGEON_NAMES,
  DUNGEON_RUNS,
  DUNGEONS,
  dungeon,
  PET_NAMES,
  petGacha,
  petPower,
  GEAR_MULT,
  JOBS,
  JOB_LINES,
  KILLS_PER_STAGE,
  MAX_SKILL,
  RARITY_NAMES,
  SKILLS,
  SKILL_NAMES,
  SLOTS,
  SLOT_EFFECTS,
  SLOT_NAMES,
  TIER_LEVEL,
  apply,
  applyJob,
  attack,
  autoAttack,
  autoMs,
  challengeNow,
  changeLine,
  costExp,
  enhance,
  autoEnhance,
  critChance,
  critMult,
  STAT_NAMES,
  statCount,
  statMax,
  enhanceCost,
  foeOf,
  fresh,
  gacha,
  gearMult,
  jobName,
  jobOf,
  join,
  learn,
  levelInfo,
  levelOf,
  lineChangeCost,
  maxHp,
  STAGE_MS,
  mobIndex,
  zoneOf,
  MISSIONS,
  dayStart,
  missionBonus,
  missionProgress,
  missionReward,
  forgeOf,
  ZONE_STAGES,
  ZONES,
  parseSave,
  questReward,
  share,
  skillPoints,
  stageOf,
  total,
  trait,
} from './game'
import type { DayStart, Dungeon, Fail, GameEvent, Hit, Purchase, Stat } from './game'
import {
  BIG_BOSS,
  BIG_BOSS_STEP,
  BIG_EXAMINER,
  BIG_LOOKS,
  BOSS,
  BOSS_STEP,
  EXAMINER,
  FONT,
  LOOKS,
  MOB_STEPS,
  MOBS,
  PALETTE,
  PETS,
  SCENE,
  SCHEMES,
  scale2,
  TINTS,
  ZONE_SCENES,
} from './sprites'
import type { Scheme } from './sprites'

const RASTER = 'field'
const FRAME_MS = 83
const IDLE_MS = 1000
const IDLE_STEPS = 4 // frames of the scene a slow tick plays: a swing lands within one
// Time counts while the session is open, drawn or not; a longer gap (a night asleep) counts as this.
const CATCH_UP_MS = 8 * 3_600_000

const save = atom({ plugin: 'idle-rpg', key: 'save' } as const, fresh(), { shape: 'save-1' })
const base = atom({ plugin: 'idle-rpg', key: 'base' } as const, fresh(), { shape: 'save-1' })
const meta = atom({ plugin: 'idle-rpg', key: 'meta' } as const, { on: true } as Meta, { shape: 'meta-1' })
/** The pane's own: whether [c] is picking a line, and the last press's answer. */
const pane = atom({ plugin: 'idle-rpg', key: 'pane' } as const, { picking: false, note: '' })

// --- The scene: one cell to two pixels, the ground on the last pixel. 작게 is 10 pixels tall; 크게
// is 18, with a hero drawn at twice the detail and the golem at twice the size.

/** Each size: its rows, where the hero and the monster stand, and the columns it needs. */
const SIZES = {
  small: { rows: 5, heroX: 2, mobX: 18, minCols: 40 }, // the hero, a boss and a damage number side by side
  big: { rows: 9, heroX: 1, mobX: 26, minCols: 70 }, // the crowned golem and its number
}
export type Size = keyof typeof SIZES
const MAX_COLS = 72
const SWING = 4 // frames an attack takes
const IMPACT = 2 // the frame of it that lands
const FLASH = 3
const ENTER = 8 // frames a monster takes to walk in
const FLOAT = 10
const FX = 8 // frames a skill's effect plays, from the hit landing
const QUEUE = 4
const DOWN = 8 // frames the hero lies fallen after a failed fight: 2 idle draws, 2/3 s at the fast pace

const rgb = (hex: string) => Number.parseInt(hex.slice(1), 16)
const colors = <T extends Record<string, string>>(hexes: T) =>
  Object.fromEntries(Object.entries(hexes).map(([c, hex]) => [c, rgb(hex)])) as Record<keyof T, number>
/** Each zone's scene colors in each scheme: the scheme's, the zone's over them. */
const ZONE_COLORS = ZONE_SCENES.map(zone => ({
  dark: colors({ ...SCHEMES.dark.scene, ...zone.dark }),
  light: colors({ ...SCHEMES.light.scene, ...zone.light }),
}))
const pals = new Map<string, Record<string, number>>()
/** A look's palette in a scheme: PALETTE, the look's colors over it, the day's swaps over both. */
const palOf = (scheme: Scheme, look: string) => {
  const key = `${scheme}:${look}`
  const known = pals.get(key)
  if (known) return known
  const made = colors({ ...PALETTE, ...LOOKS[look]?.colors, ...SCHEMES[scheme].palette })
  pals.set(key, made)
  return made
}

/** The monster on screen, and the hero's look (LOOKS; the 인턴's when absent). */
export type View = { kills: number; boss: boolean; left: number; exam?: boolean; look?: string; pet?: number }

export type Scene = {
  t: number
  /** Hits still to play, the newest last. */
  queue: Hit[]
  /** The hit being played. */
  cur?: Hit
  swing: number
  flash: number
  enter: number
  /** Frames left of the skill effect over the monster; the hit stays the current one till then. */
  fx: number
  /** Frames walked so far, each monster's walk-in being ENTER of them: it slides the hills. */
  walked: number
  /** Frames left of the hero lying fallen; no hit plays till it is up. */
  down: number
  floats: { text: string; crit: boolean; y: number; life: number }[]
}

export const newScene = (): Scene => ({ t: 0, queue: [], swing: 0, flash: 0, enter: 0, fx: 0, walked: 0, down: 0, floats: [] })

/**
 * The examiner stepping in with no kill before it (a 전직 applied for) walks in as a monster does,
 * its alarm with it. Says whether the examiner is up now, for the next frame to compare.
 */
export const meetExaminer = (s: Scene, exam: boolean, was: boolean) => {
  if (exam && !was && s.enter === 0) s.enter = ENTER
  return exam
}

/** A failed fight: the hits in flight are dropped, and the hero lies a moment before the next. */
export const fall = (s: Scene) => {
  s.queue = []
  s.cur = undefined
  s.swing = 0
  s.fx = 0
  s.down = DOWN
}

const damageText = (dmg: number) =>
  dmg < 10_000 ? String(dmg) : dmg < 1e7 ? `${Math.floor(dmg / 1000)}K` : dmg.toExponential(0).replace('e+', 'E')

/** Advances one frame; `dt` moves only the idle clock, for the slow timer. */
export const stepScene = (s: Scene, dt = 1) => {
  s.t += dt
  if (s.enter > 0) {
    s.enter--
    s.walked++
  }
  if (s.flash > 0) s.flash--
  if (s.fx > 0) s.fx--
  if (s.down > 0) s.down--
  if (s.swing > 0) {
    s.swing--
    if (s.swing === IMPACT && s.cur) {
      s.flash = FLASH
      if (s.cur.skill) s.fx = FX
      s.floats.push({ text: damageText(s.cur.dmg), crit: s.cur.crit || s.cur.skill !== undefined, y: 4, life: FLOAT })
    }
  }
  if (s.cur && s.swing === 0 && s.flash === 0 && s.fx === 0) {
    if (s.cur.killed) s.enter = ENTER
    s.cur = undefined
  }
  if (!s.cur && s.enter === 0 && s.down === 0 && s.queue.length > 0) {
    s.cur = s.queue.shift()
    s.swing = SWING
  }
  for (const f of s.floats) {
    f.y -= 0.5
    f.life--
  }
  s.floats = s.floats.filter(f => f.life > 0)
}

/** Whether the next frame differs by more than the idle bob: pick the fast timer. */
export const isMoving = (s: Scene) => s.queue.length > 0 || s.cur !== undefined || s.enter > 0 || s.down > 0 || s.floats.length > 0

/** The monster on screen: the save's, less the kills the scene has yet to play. */
const viewOf = (s: Scene, x: Save): View => {
  const unplayed = [...s.queue, ...(s.cur ? [s.cur] : [])].filter(hit => hit.killed)
  const kills = Math.max(0, x.kills - unplayed.filter(hit => hit.advanced).length)
  const foe = foeOf({ ...x, kills })
  const { line, tier } = jobOf(x)
  return {
    kills,
    boss: foe.boss,
    // The hit being played says who it fell on: the examiner stays for its last blow.
    exam: s.cur ? s.cur.exam === true : foe.exam,
    left: unplayed.length > 0 ? 0 : Math.max(0, 1 - x.dmg / foe.hp),
    look: line ? `${line}${tier}` : 'intern',
    ...(x.pet && { pet: x.pet.rarity }),
  }
}

/** One color per pixel, row-major, `cols` by the size's height. */
export const paintScene = (s: Scene, view: View, cols: number, scheme: Scheme = 'dark', size: Size = 'small') => {
  const { rows, heroX, mobX: baseX } = SIZES[size]
  const H = rows * 2
  const GROUND = H - 1
  const big = size === 'big'
  // A pet stands at the hero's back: the hero and the monster step right to make room.
  const petArt = view.pet ? (big ? scale2(PETS[view.pet] ?? []) : (PETS[view.pet] ?? [])) : []
  const room = petArt.length > 0 ? (petArt[0]?.length ?? 0) + 1 : 0
  const HERO_X = heroX + room
  const MOB_X = baseX + room
  const COLOR = (ZONE_COLORS[zoneOf(view.kills)] ?? ZONE_COLORS[0])![scheme]
  const PAL = palOf(scheme, view.look ?? 'intern')
  const looks = big ? BIG_LOOKS : LOOKS
  const art = looks[view.look ?? 'intern'] ?? looks.intern
  // A boss or the examiner walking in reddens the sky, and says so over it.
  const alarm = s.enter > 0 && (view.boss || view.exam === true)
  const p = new Uint32Array(cols * H).fill(alarm ? COLOR.alarm : COLOR.sky)
  const px = (x: number, y: number, c: number) => {
    const a = Math.round(x)
    const b = Math.round(y)
    if (a >= 0 && a < cols && b >= 0 && b < H) p[b * cols + a] = c
  }
  /**
   * Draws a sprite in `pal`, or all in `ink`, ringed in the outline color first unless `ring` is
   * off. Letters in `bare` (an attack's slash) are drawn but not ringed; no ring covers the ground.
   */
  type Draw = { ink?: number; ring?: boolean; bare?: string; pal?: Record<string, number> }
  const sprite = (rows: readonly string[], sx: number, sy: number, { ink, ring = true, bare = '', pal = PAL }: Draw = {}) => {
    const solid = (i: number, j: number) => {
      const c = rows[j]?.[i]
      return c !== undefined && c !== '.' && !bare.includes(c)
    }
    const wide = rows[0]?.length ?? 0
    for (let j = -1; ring && j <= rows.length; j++) {
      for (let i = -1; i <= wide; i++) {
        const near = solid(i - 1, j) || solid(i + 1, j) || solid(i, j - 1) || solid(i, j + 1)
        if (!solid(i, j) && near && sy + j < GROUND) px(sx + i, sy + j, PAL.K ?? 0)
      }
    }
    rows.forEach((row, j) => {
      ;[...row].forEach((c, i) => {
        const color = c === '.' ? undefined : (ink ?? pal[c])
        if (color !== undefined) px(sx + i, sy + j, color)
      })
    })
  }

  for (let x = 0; x < cols; x++) if (scheme === 'dark' && (x * 7919) % 11 === 0) px(x, (x * 31) % 6, COLOR.star)
  // The day's clouds: a puff every 23 columns, a row lower every other one, drifting left.
  if (scheme === 'light') {
    const drift = Math.floor(s.t / 24)
    for (let n = Math.floor(drift / 23); 23 * n - drift < cols; n++) {
      const x0 = 7 + 23 * n - drift
      const y = n % 2 === 0 ? 1 : 0
      for (let i = 1; i < 4; i++) px(x0 + i, y, COLOR.star)
      for (let i = 0; i < 6; i++) px(x0 + i, y + 1, COLOR.star)
    }
  }
  // Far hills and a tree every 17 columns, slid along as each monster walks in, 6 pixels a monster.
  const walk = Math.round((s.walked * 6) / ENTER)
  for (let x = 0; x < cols; x++) {
    const u = x + walk
    const rise = 1 + Math.round((1.5 + 1.5 * Math.sin(u / 6)) * (H / 10))
    for (let y = GROUND - rise; y < GROUND; y++) px(x, y, COLOR.hill)
    if (((u % 17) + 17) % 17 === 0) {
      for (let y = GROUND - 6; y < GROUND; y++) px(x, y, COLOR.tree)
      for (const y of [GROUND - 5, GROUND - 4, GROUND - 3]) for (const i of [-1, 1]) px(x + i, y, COLOR.tree)
      for (const i of [-2, 2]) px(x + i, GROUND - 4, COLOR.tree)
    }
    px(x, GROUND, COLOR.ground)
  }

  const beat = (s.t >> 3) & 1
  const stand = s.swing > IMPACT ? art?.swing[0] : s.cur ? art?.swing[1] : art?.idle[beat]
  // Fallen, the hero is squashed to every other row, flat on the ground.
  const hero = s.down > 0 ? art?.idle[0]?.filter((_, j) => j % 2 === 1) : stand
  if (hero) sprite(hero, HERO_X, GROUND - hero.length, { bare: 'C' })
  // The pet hops as the hero swings.
  if (petArt.length > 0) sprite(petArt, heroX, GROUND - petArt.length - (s.swing > 0 ? 1 : 0))

  // A monster shifts to its second frame on the off beat while it waits, and hops as it walks in.
  const kind = view.boss ? MOBS.length : mobIndex(view.kills)
  const step = beat === 1 && s.enter === 0 && !s.cur
  const boss = big ? (step ? BIG_BOSS_STEP : BIG_BOSS) : step ? BOSS_STEP : BOSS
  const mob = view.exam ? (big ? BIG_EXAMINER : EXAMINER) : ([...(step ? MOB_STEPS : MOBS), boss][kind] ?? boss)
  const tints = TINTS[kind] ?? []
  const tint = view.exam ? {} : (tints[(stageOf(view.kills) - 1) % tints.length] ?? {})
  const wide = mob[0]?.length ?? 0
  const mobX = MOB_X + Math.round(((cols - MOB_X) * s.enter) / ENTER)
  const hop = mob.length < GROUND && s.enter % 2 === 1 ? 1 : 0
  const ink = s.flash > 0 ? COLOR.flash : undefined
  sprite(mob, mobX, GROUND - mob.length - hop, { ink, pal: { ...PAL, ...colors(tint) } })
  if (s.enter === 0) {
    const full = Math.round(wide * view.left)
    for (let i = 0; i < wide; i++) px(mobX + i, GROUND, i < full ? COLOR.hp : COLOR.hpLost)
  }

  // A skill's effect over the monster, in the crit color: each line its own.
  const skill = s.cur?.skill
  if (skill && s.fx > 0) {
    const p = FX - s.fx // 0 as it lands
    const top = GROUND - mob.length
    const cx = mobX + Math.floor(wide / 2)
    const cy = Math.floor((top + GROUND) / 2)
    const fx = (x: number, y: number) => {
      if (y < GROUND) px(x, y, COLOR.crit)
    }
    if (skill === 'melee') {
      // A cut down through it, then across.
      for (let y = 0; y < Math.min(GROUND, ((p + 1) * GROUND) / 3); y++) fx(cx, y)
      if (p >= 3) for (let x = mobX - 2; x < mobX + wide + 2; x++) fx(x, cy)
    } else if (skill === 'magic') {
      // A ring that spreads out from its middle.
      const ring = 1 + Math.round((p * H) / 10)
      for (let dx = -ring; dx <= ring; dx++) {
        const dy = ring - Math.abs(dx)
        fx(cx + dx, cy - dy)
        fx(cx + dx, cy + dy)
      }
    } else if (skill === 'ranged') {
      // A rain of arrows on it: shafts three pixels long, falling at staggered heights.
      for (let i = 0; i < 7; i++) {
        const x = mobX - 2 + Math.round(((wide + 3) * i) / 6)
        const y = ((p * 3 + i * 5) % (GROUND + 3)) - 3
        for (let j = 0; j < 3; j++) fx(x, y + j)
      }
    } else {
      // Three slashes, crossing, one every other frame.
      const tall = GROUND - top
      for (let k = 0; k <= Math.min(2, p >> 1); k++) {
        for (let j = 0; j < tall; j++) {
          const x = mobX - 1 + k * 2 + Math.round((j * wide) / tall)
          fx(k % 2 === 0 ? x : 2 * mobX + wide - x, top + j)
        }
      }
    }
  }

  if (alarm) {
    const x0 = Math.floor(cols / 2) - 10
    ;[...'BOSS!'].forEach((c, i) => sprite(FONT[c] ?? [], x0 + i * 4, 0, { ink: COLOR.crit, ring: false }))
  }

  s.floats.forEach((f, n) => {
    // Right of the monster, but kept on screen: a pet's room can push it past the edge.
    const x0 = Math.min(MOB_X + wide + 2 + n * 2, cols - f.text.length * 4)
    ;[...f.text].forEach((digit, i) => {
      sprite(FONT[digit] ?? [], x0 + i * 4, f.y + H - 10, { ink: f.crit ? COLOR.crit : COLOR.damage, ring: false })
    })
  })
  return p
}

const UPPER_HALF = 0x2580

/** RasterProps `cells`: an upper half block per cell, its foreground the upper pixel. */
export const sceneCells = (s: Scene, view: View, cols: number, scheme: Scheme = 'dark', size: Size = 'small', rows = SIZES[size].rows) => {
  const p = paintScene(s, view, cols, scheme, size)
  // Fewer rows than the size's cut the sky off from the top: the ground and who stands on it stay.
  const cut = SIZES[size].rows - rows
  const words = new Uint32Array(cols * rows * 3)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const at = (r * cols + c) * 3
      words[at] = UPPER_HALF
      words[at + 1] = p[(r + cut) * 2 * cols + c] ?? 0
      words[at + 2] = p[((r + cut) * 2 + 1) * cols + c] ?? 0
    }
  }
  const bytes = new Uint8Array(words.buffer) as Uint8Array & { toBase64: () => string }
  return bytes.toBase64()
}

// ponytail: counts a column of texts, fields and bordered boxes, which is what the taxi and the
// office draw; a text that wraps or a box with margins counts short, and the band then scrolls.
/** The rows a settled tree takes. */
export const rowsOf = (node: unknown): number => {
  if (typeof node !== 'object' || node === null) return 0
  const { type, props, children } = node as { type?: string; props?: Record<string, unknown>; children?: unknown }
  if (type === 'Raster') return Number(props?.rows) || 0
  if (type !== 'Box') return 1
  const inner = [children].flat(Infinity).map(rowsOf)
  const stacked = props?.flexDirection === 'column' ? inner.reduce((sum, n) => sum + n, 0) : Math.max(0, ...inner)
  return stacked + (props?.borderStyle ? 2 : 0)
}

export type Layout = { size: Size; rows: number; line: boolean }

/**
 * What this row draws in a band of `maxRows` where other plugins' rows take `others`: the scene in
 * the size asked for and the line under it, or 작게 when 크게 does not fit. Short of room for both,
 * the scene comes first, without the line and its sky cut down to the rows there are; the line
 * alone only where two rows or the columns for the hero and a boss are not left.
 */
export const bandLayout = (maxRows: number, columns: number, others: number, size: Size = 'small'): Layout => {
  const room = maxRows - others
  const fits = (at: Size) => room > SIZES[at].rows && columns >= SIZES[at].minCols
  if (size === 'big' && fits('big')) return { size: 'big', rows: SIZES.big.rows, line: true }
  if (fits('small')) return { size: 'small', rows: SIZES.small.rows, line: true }
  if (room >= 2 && columns >= SIZES.small.minCols) return { size: 'small', rows: Math.min(room, SIZES.small.rows), line: false }
  return { size: 'small', rows: 0, line: room >= 1 }
}

// --- Words.

const UNITS = ['', 'K', 'M', 'B', 'T']
export const amount = (n: number) => {
  if (n < 10_000) return String(Math.floor(n))
  if (n >= 1e15) return n.toExponential(1).replace('+', '')
  const unit = Math.floor(Math.log10(n) / 3)
  return `${(n / 1000 ** unit).toFixed(1)}${UNITS[unit]}`
}
const BAR = 8
const expBar = (x: Save) => {
  const { into, need } = levelInfo(x.exp)
  const full = Math.min(BAR, Math.floor((into / need) * BAR))
  return '█'.repeat(full) + '░'.repeat(BAR - full)
}
/** A slot's 합성 level, as the report and the pane write it after the rarity; nothing at 0. */
const stars = (x: Save, slot: Slot) => (forgeOf(x, slot) > 0 ? `★${forgeOf(x, slot)}` : '')
const zoneName = (x: Save) => ZONES[zoneOf(x.kills)]?.name ?? ''
/** The stages of the zone the hero is in. */
const zoneStages = (x: Save) => {
  const first = Math.floor((stageOf(x.kills) - 1) / ZONE_STAGES) * ZONE_STAGES + 1
  return `스테이지 ${first}~${first + ZONE_STAGES - 1}`
}
const stageLabel = (x: Save) => `${stageOf(x.kills)}-${(x.kills % KILLS_PER_STAGE) + 1}`
const foe = (x: Save) => {
  const { name, hp } = foeOf(x)
  return `${name} ${amount(Math.max(0, hp - x.dmg))}/${amount(hp)}`
}
const hpText = (x: Save) => `HP ${amount(Math.max(0, maxHp(x) - x.hurt))}/${amount(maxHp(x))}`
/** The fight's clock: the time a challenge has left, or how far a retreat lap has come. */
const clock = (x: Save) =>
  x.lap > 0 ? `반복 사냥 ${KILLS_PER_STAGE - x.lap}/${KILLS_PER_STAGE}` : `${Math.max(0, Math.ceil((STAGE_MS - x.ms) / 1000))}초`
/** While a retreat lap runs, what it leads back to. */
const lapNote = (x: Save) => (x.lap > 0 ? `후퇴 중: 반복 사냥이 끝나면 ${jobOf(x).trial ? EXAM_NAME : `스테이지 ${stageOf(x.kills) + 1}`}에 다시 도전해요` : '')

/** The level the next 전직 opens at, while none is pending; undefined past 3차 or mid-trial. */
const nextTierLevel = (x: Save) => {
  const { tier, trial } = jobOf(x)
  return trial || tier >= 3 ? undefined : TIER_LEVEL[tier + 1]
}
/** Whether a 전직 can be applied for now. */
const canApply = (x: Save) => levelOf(x.exp) >= (nextTierLevel(x) ?? Infinity)

/** The band's word on a pending trial: the examiner up, or met again after the lap. */
export const trialTag = (x: Save) => {
  if (!jobOf(x).trial) return ''
  return foeOf(x).exam ? '[전직 시험 중]' : '[전직 시험 대기]'
}
/** The trial's state in words, as the pane and the report put it. */
const examState = (x: Save) => (foeOf(x).exam ? `${EXAM_NAME}과 전투 중` : `반복 사냥 뒤 ${EXAM_NAME}에 다시 도전`)

const SKILL_HELP: Record<SkillId, string> = {
  flurry: '도구 호출 때 15%씩 한 번 더 강타',
  crit: '5%씩 치명타 확률',
  greed: '골드 +10%씩',
}

const TRAIT_TEXT: Record<JobLine, (x: Save) => string> = {
  melee: x => `도구 호출 타격 ${trait(x, 'toolHit')}배`,
  magic: x => `경험치 x${trait(x, 'exp')}`,
  ranged: x => `자동 공격 ${trait(x, 'autoMs') / 1000}초마다`,
  rogue: x => `치명타 +${trait(x, 'crit')}%p · 골드 x${trait(x, 'gold')}`,
}

/** The job, what it trains, and the way to the next. */
const jobText = (x: Save) => {
  const job = jobOf(x)
  const parts = [job.line ? `${jobName(job)} (${JOBS[job.line].label} ${job.tier}차) · ${TRAIT_TEXT[job.line](x)}` : jobName(job)]
  if (job.trial) {
    parts.push(`전직 시험 중 → ${jobName({ line: job.trial.line, tier: (job.tier + 1) as 1 })} · ${examState(x)}`)
  } else if (nextTierLevel(x) !== undefined) {
    parts.push(`${job.tier + 1}차 전직 Lv.${nextTierLevel(x)}부터${canApply(x) ? ' (지금 가능)' : ''}`)
  }
  return parts.join(' · ')
}

/** The stats past 강화 and 체력 강화, which 자동 leaves to the person. */
const EXTRA_STATS = ['critRate', 'critDmg', 'haste'] as const
const pct = (n: number) => `${Number((n * 100).toFixed(1))}%`
/** What a stat does now, in words. */
const STAT_EFFECT: Record<Stat, (x: Save) => string> = {
  enhance: x => `공격력 ${amount(attack(x))}`,
  vit: x => `최대 HP ${amount(maxHp(x))}`,
  critRate: x => `치명타 확률 ${pct(critChance(x))}`,
  critDmg: x => `치명타 피해 x${Number(critMult(x).toFixed(1))}`,
  haste: x => `자동 공격 ${autoMs(x) / 1000}초마다`,
}
/** The three, with their levels and caps. */
const statLine = (x: Save) =>
  EXTRA_STATS.map(stat => `${STAT_EFFECT[stat](x)} (+${x[stat]}${statMax(stat) < Infinity ? `/${statMax(stat)}` : ''})`).join(' · ')
/** A stat's next price, or 최대 at its cap. */
const priceOf = (x: Save, stat: Stat) => (x[stat] >= statMax(stat) ? '최대' : `${amount(enhanceCost(x, stat))}골드`)
/** /rpg's word for each stat. */
const STAT_VERBS: Record<string, Stat> = { 강화: 'enhance', 체력: 'vit', 치명: 'critRate', 치피: 'critDmg', 속도: 'haste' }

/** The pet and what it adds, or none. */
const petText = (x: Save) =>
  x.pet ? `${RARITY_NAMES[x.pet.rarity]} ${PET_NAMES[x.pet.rarity]} Lv.${x.pet.level} (자동 공격마다 공격력 +${Math.round(petPower(x) * 100)}%)` : '없음'

/** 환생 so far, and what one now would give. */
const rebirthText = (x: Save) => {
  const { count, points } = rebirthOf(x)
  const so = count > 0 ? `${count}회 · 포인트 ${points} (공격력·골드 x${Number(rebirthBonus(x).toFixed(1))})` : '아직 없음'
  return `${so} · ${stageOf(x.best) >= REBIRTH_STAGE ? `지금 하면 포인트 +${rebirthGain(x)}` : `스테이지 ${REBIRTH_STAGE}부터`}`
}

export const report = (x: Save) => {
  const { level, into, need } = levelInfo(x.exp)
  const gear = SLOTS.map(slot => {
    const rarity = x.gear[slot]
    return `${SLOT_NAMES[slot]} ${RARITY_NAMES[rarity]}${stars(x, slot)}${rarity > 0 ? `(${SLOT_EFFECTS[slot]} x${Number(gearMult(x, slot).toFixed(2))})` : ''}`
  })
  return [
    `${jobName(jobOf(x))} Lv.${level} · 다음 레벨까지 경험치 ${amount(Math.ceil(need - into))}`,
    `직업: ${jobText(x)}`,
    `스테이지 ${stageLabel(x)} (${zoneName(x)}) · ${clock(x)} · 상대: ${foe(x)}${lapNote(x) && ` · ${lapNote(x)}`}`,
    `골드 ${amount(x.gold)} · 공격력 ${amount(attack(x))} · 강화 +${x.enhance} · ${hpText(x)} · 체력 강화 +${x.vit}`,
    `능력치: ${statLine(x)}`,
    `장비: ${gear.join(' · ')}`,
    `펫: ${petText(x)}`,
    `환생: ${rebirthText(x)}`,
    ...(missionLine(x) ? [`오늘의 미션: ${missionLine(x)}`] : []),
    `스킬 (남은 포인트 ${skillPoints(x)}): ${SKILLS.map(id => `${SKILL_NAMES[id]} ${x.skills[id]}/${MAX_SKILL}`).join(' · ')}`,
    `다음 강화: ${amount(enhanceCost(x))}골드 · 체력 강화: ${amount(enhanceCost(x, 'vit'))}골드 · ${EXTRA_STATS.map(stat => `${STAT_NAMES[stat]}: ${priceOf(x, stat)}`).join(' · ')} · 뽑기: ${amount(gachaCost(x))}골드`,
    `스테이지마다 ${STAGE_MS / 1000}초 안에 10마리를 잡아야 해요. 시간이 지나거나 쓰러지면 이전 스테이지로 후퇴해 한 바퀴 돈 뒤 다시 도전해요.`,
    '',
    '명령',
    '  /rpg 강화: 공격력 10% 증가 (한 번)',
    '  /rpg 강화 최대: 골드가 되는 만큼 강화',
    '  /rpg 체력 [최대]: 최대 HP 10% 증가 (한 번, 또는 골드가 되는 만큼)',
    `  /rpg 치명 [최대]: 치명타 확률 +1%p (최대 +${statMax('critRate')})`,
    '  /rpg 치피 [최대]: 치명타 피해 +0.1배',
    `  /rpg 속도 [최대]: 공격 속도 +2% (최대 +${statMax('haste')})`,
    `  /rpg 던전 <골드|경험치>: 하루 ${DUNGEON_RUNS}번씩, 가장 멀리 간 스테이지 몬스터를 ${DUNGEON_MS / 1000}초 동안 사냥해 5배 보상`,
    '  /rpg 도전: 반복 사냥 중에 남은 바퀴를 건너뛰고 바로 다시 도전',
    `  /rpg 환생: 스테이지 ${REBIRTH_STAGE}부터, 장비·합성·펫만 남기고 처음부터 다시 (10스테이지마다 포인트 1, 포인트마다 공격력·골드 +10% 영구)`,
    `  /rpg 펫: 펫 뽑기 ${amount(petCost(x))}골드 (같거나 낮은 등급이 나오면 지금 펫 레벨 +1)`,
    '  /rpg 뽑기: 무작위 장비 (일반 60% · 희귀 28% · 영웅 10% · 전설 2%)',
    ...SKILLS.map(id => `  /rpg 스킬 ${SKILL_NAMES[id]}: ${SKILL_HELP[id]}`),
    '  /rpg 전직 [근접|마법|원거리|암살]: Lv.10·30·60부터 전직 시험 신청 (인턴은 계열을 골라요)',
    `  /rpg 계열 <이름>: 같은 차수에서 계열 바꾸기 (다음 강화 20번 값, 지금 ${amount(lineChangeCost(x))}골드)`,
    `  /rpg 테마 [시스템|다크|라이트]: 사냥터 색 (지금 ${THEME_NAMES[theme]})`,
    `  /rpg 크기 [작게|크게]: 사냥터 크기 (지금 ${SIZE_NAMES[size]})`,
    `  /rpg 자동 [켜기|끄기]: 골드가 쌓이는 대로 공격·체력 강화, 다음 전직 자동 신청 (지금 ${auto ? '켜짐' : '꺼짐'})`,
    '  /rpg 끄기 · /rpg 켜기: 띠 숨기기 · 다시 보이기 (꺼도 사냥은 계속돼요)',
  ].join('\n')
}

// --- The simulation: apart from the drawing, so it goes on while the band is hidden.

// Module variables: a reload starts them over, and the render hook starts the timer again.
let scene = newScene()
let cols = MAX_COLS
let shownSkill: JobLine | undefined // the skill the band's line last named
let shownExam = false // whether the last frame drew the examiner
let drawn: Size = 'small' // the size the band last laid out: the frames between draw at it
let drawnRows = SIZES.small.rows // and the rows of it, fewer where the band is short
let band = ''
let anim: Timer | undefined
let animFast = false
let denied = 0
let working = false // a model turn is running: the field plays every frame
let otherRows = 0 // what the other plugins' rows take of the band
let lastAt = 0
let spare = 0 // elapsed time short of one attack
let pace = 1500 // the save's last auto-attack interval: only says when there may be one to make
let saving: Promise<unknown> = Promise.resolve()

// --- The theme: the person's setting, kept in the store; `system` follows macOS's appearance.

const THEMES = ['system', 'dark', 'light'] as const
type Theme = (typeof THEMES)[number]
const THEME_NAMES: Record<Theme, string> = { system: '시스템', dark: '다크', light: '라이트' }
const SYSTEM_MS = 30_000
let theme: Theme = 'system'
let systemDark = true
let systemAt = -Infinity

const scheme = (): Scheme => (theme === 'system' ? (systemDark ? 'dark' : 'light') : theme)

/** Asks macOS at most every SYSTEM_MS, never waited on: a change redraws. No answer reads dark. */
const checkSystem = ($: EngineInterface, now: number) => {
  if (theme !== 'system' || now - systemAt < SYSTEM_MS) return
  systemAt = now
  const seen = (dark: boolean) => {
    if (dark === systemDark) return
    systemDark = dark
    $.ui.invalidate('ui.render')
  }
  // Light mode has no AppleInterfaceStyle at all: the read fails with nothing on stdout.
  $.process.run(['defaults', 'read', '-g', 'AppleInterfaceStyle'], { timeoutMs: 2000 }).then(
    r => seen(r.stdout.trim() === 'Dark'),
    () => seen(true),
  )
}

const setTheme = async ($: EngineInterface, name: string) => {
  const next = THEMES.find(t => THEME_NAMES[t] === name || t === name) ?? (name ? undefined : THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length])
  if (!next) return `테마는 ${THEMES.map(t => THEME_NAMES[t]).join(', ')} 중에서 골라 주세요.`
  theme = next
  systemAt = -Infinity
  checkSystem($, await $.clock.now())
  await $.store.set('theme', next)
  $.ui.invalidate('ui.render')
  return `테마: ${THEME_NAMES[next]}${next === 'system' ? ' (macOS 화면 모드를 따라가요)' : ''}`
}

// --- The size: 작게 or 크게, the person's setting, kept in the store. 작게 unless asked.

const SIZE_NAMES: Record<Size, string> = { small: '작게', big: '크게' }
let size: Size = 'small'

const setSize = async ($: EngineInterface, name: string) => {
  const sizes = Object.keys(SIZE_NAMES) as Size[]
  const next = sizes.find(at => SIZE_NAMES[at] === name || at === name) ?? (name ? undefined : size === 'small' ? 'big' : 'small')
  if (!next) return `크기는 ${sizes.map(at => SIZE_NAMES[at]).join(', ')} 중에서 골라 주세요.`
  size = next
  await $.store.set('size', next)
  $.ui.invalidate('ui.render')
  return `크기: ${SIZE_NAMES[next]}${next === 'big' ? ` (사냥터 ${SIZES.big.rows}줄, 자리가 모자라면 작게 그려요)` : ''}`
}

/**
 * What a move of this session's own made happen, a line per kind at most: a catch-up of hundreds
 * of hits says each thing once. A rescan of other rows never comes here, so it stays quiet.
 */
export const news = (before: Save, after: Save, hits: readonly Hit[]) => {
  const said: string[] = []
  const [from, to] = [levelOf(before.exp), levelOf(after.exp)]
  if (to > from) said.push(`레벨 업! Lv.${to} · 스킬 포인트 +${to - from}`)
  // Only ground never reached before is news: a retreat and its retry say nothing.
  const reached = stageOf(after.best) > stageOf(before.best)
  if (reached && hits.some(h => h.killed && h.boss)) said.push(`보스 ${BOSS_NAME} 처치! 스테이지 ${stageOf(after.best)}`)
  if (reached && zoneOf(after.best) !== zoneOf(before.best)) said.push(`새 지역: ${zoneName({ ...after, kills: after.best })}! ${zoneStages({ ...after, kills: after.best })}`)
  const opens = nextTierLevel(before)
  const applied = !jobOf(before).trial && jobOf(after).trial
  if (applied) said.push(`${jobOf(after).tier + 1}차 전직 시험 자동 신청! ${STAGE_MS / 1000}초 안에 ${EXAM_NAME}을 쓰러뜨려요`)
  else if (opens !== undefined && from < opens && canApply(after)) {
    said.push(`전직 가능! Lv.${opens} 달성 · /rpg 전직${jobOf(after).tier === 0 ? ' <계열>' : ''}`)
  }
  if (jobOf(after).tier > jobOf(before).tier) said.push(`전직 완료! 이제 ${jobName(jobOf(after))}`)
  return said
}

// --- 자동 강화: the person's setting, kept in the store; off unless asked. On, the gold goes to 강화
// as it comes, attack or 체력 as the next challenge wants, but for one 뽑기's worth, and a hero with
// a line applies for the next 전직 once it may.
// ponytail: two sessions spend the same gold until a rescan shows each the other's spending; the
// rows then owe it, and the gold reads 0 until earnings pay it off. A per-store lock fixes it.

let auto = false

/** The save with what 자동 강화 buys out of its gold, and the next 전직 applied for. */
const grow = (x: Save, now: number) => {
  if (!auto) return x
  const s = autoEnhance(x, gachaCost(x))
  const job = jobOf(s)
  if (job.line === null || job.trial || !canApply(s)) return s
  const applied = applyJob(s, '', now)
  return 'refused' in applied ? s : applied.save
}

const setAuto = async ($: EngineInterface, name: string) => {
  const next = name === '켜기' ? true : name === '끄기' ? false : name ? undefined : !auto
  if (next === undefined) return '자동 강화는 켜기, 끄기 중에서 골라 주세요.'
  auto = next
  await $.store.set('auto', next)
  const now = await $.clock.now()
  if (next) await buy($, x => ({ save: grow(x, now), note: '' }))
  await sync($, false)
  $.ui.invalidate('ui.render')
  return next ? `자동 강화: 켜짐 (골드가 쌓이는 대로 공격·체력을 강화하고 뽑기 한 번 값은 남겨요)` : '자동 강화: 꺼짐'
}

/** A failed challenge, said once as it happens; a fall mid-lap says nothing, the band shows the lap. */
export const failNote = (fail: Fail, after: Save) =>
  `${fail === 'time' ? '시간 초과' : '쓰러졌어요'}! 스테이지 ${stageOf(after.kills)}에서 반복 사냥 뒤 다시 도전해요`

/** A catch-up this long or longer is time away: it says what came of it. */
const AWAY_MS = 10 * 60_000

/** What time away brought: the kills, the gold and exp they paid, what 자동 강화 bought, the retreats. */
export const awayNote = (ms: number, hits: readonly Hit[], gold: number, exp: number, enhanced: number, label = '자리 비운', fails = 0) => {
  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  const away = [hours > 0 && `${hours}시간`, minutes % 60 > 0 && `${minutes % 60}분`].filter(Boolean).join(' ')
  const kills = hits.filter(hit => hit.killed).length
  const parts = [`몬스터 ${amount(kills)}마리 처치`, `골드 +${amount(gold)}`, `경험치 +${amount(exp)}`]
  if (enhanced > 0) parts.push(`자동 강화 +${enhanced}`)
  if (fails > 0) parts.push(`후퇴 ${fails}번`)
  return `${label} ${away} 동안: ${parts.join(' · ')}`
}

// --- 오프라인 보상: time with no session open counts at half, up to CATCH_UP_MS of it. Every open
// session says it is here (`seen`) on its 30-second timer; a session that starts and finds that
// older than AWAY_MS pays the gap, having moved `seen` on first so the next one starting does not.
// ponytail: two sessions starting in the same instant both pay, as quest rewards can; and a laptop
// that wakes into a new session before the old one's timer fires pays time the old one also counts.

const SEEN = 'seen'
const OFFLINE_RATE = 0.5

const beat = async ($: EngineInterface) => $.store.set(SEEN, await $.clock.now())

const offline = async ($: EngineInterface) => {
  const now = await $.clock.now()
  const seen = await $.store.get(SEEN)
  await beat($)
  if (typeof seen !== 'number' || now - seen < AWAY_MS) return
  const ms = Math.min(now - seen, CATCH_UP_MS)
  await play($, { type: 'tick', ms: ms * OFFLINE_RATE }, { ms, label: '세션을 닫아 둔', tail: ' (절반 효율)' })
  await sync($, false)
}

/** A long tick is played in pieces this long, 자동 강화 buying between: it climbs as it goes. */
const GROW_MS = 10 * 60_000

/**
 * Moves the save by `event`; a tick hands back the time short of its next attack. A tick that long
 * or longer says what it brought: as time away, or as `away` says (the closed time it stood for).
 */
const play = async ($: EngineInterface, event: GameEvent, away?: { ms: number; label: string; tail?: string }) => {
  const now = await $.clock.now()
  let hits: Hit[] = []
  let fails: Fail[] = []
  let left = 0
  let earned = 0 // gold the hits paid, before 자동 강화 spends it
  let before = fresh()
  const after = await update($, save, x => {
    before = x
    if (event.type !== 'tick') {
      const next = apply(x, event, Math.random, now)
      hits = next.hits
      return grow(next.save, now)
    }
    hits = []
    fails = []
    earned = 0
    let s = x
    let rest = event.ms
    for (;;) {
      const step = Math.min(rest, GROW_MS)
      const next = autoAttack(s, step, Math.random, now)
      hits.push(...next.hits)
      fails.push(...next.fails)
      earned += next.save.gold - s.gold
      s = grow(next.save, now)
      rest = rest - step + next.left
      if (step < GROW_MS || rest < autoMs(s)) break
    }
    left = rest
    return s
  })
  pace = autoMs(after)
  // A long catch-up is hundreds of hits: the scene plays the last few.
  scene.queue = [...scene.queue, ...hits].slice(-QUEUE)
  if (event.type === 'tick' && (away || event.ms >= AWAY_MS)) {
    const { ms, label } = away ?? { ms: event.ms, label: '자리 비운' }
    const bought = statCount(after) - statCount(before)
    const note = awayNote(ms, hits, earned, after.exp - before.exp, bought, label, fails.length) + (away?.tail ?? '')
    $.ui.toast(note)
    await update($, pane, p => ({ ...p, note }))
  } else {
    const failed = fails.findLast(f => f !== 'lap')
    if (failed) $.ui.toast(failNote(failed, after))
    if (fails.length > 0) fall(scene)
  }
  for (const text of news(before, after, hits)) $.ui.toast(text)
  return left
}

/** Turns the time since the last call into auto attacks, at the pace the save's job sets. */
const advance = async ($: EngineInterface) => {
  const now = await $.clock.now()
  // No await between reading and moving lastAt and spare: the timer, tool calls and commands all
  // come here. The time is taken whole and what the attacks leave of it put back after.
  const elapsed = lastAt === 0 ? 0 : Math.min(Math.max(0, now - lastAt), CATCH_UP_MS)
  lastAt = Math.max(lastAt, now)
  spare += elapsed
  if (spare < pace) return
  const ms = spare
  spare = 0
  spare += await play($, { type: 'tick', ms })
}

const LEGACY = 'save' // the one save every session used to write; read as a share, never written
const rowKey = (id: string) => `s:${id}`

// ponytail: as the taxi's ledger, a row per session and one store.get each per read; rows are never
// folded. Fine to thousands; past that, fold the rows of ended sessions into one key.
const others = async ($: EngineInterface, id: string) => {
  const keys = (await $.store.keys()).filter(k => k.startsWith('s:') && k !== rowKey(id))
  const rows = await Promise.all([LEGACY, ...keys].map(k => $.store.get(k)))
  return rows.map(parseSave).reduce(join, fresh())
}

/**
 * Writes this session's row, the only one it ever writes, so no two sessions race and a write that
 * fails is made good by the next. With `rescan` the other rows are read again first: what another
 * session earned or spent, and how far it got, joins the save.
 */
const sync = ($: EngineInterface, rescan = true) => {
  const run = async () => {
    const [id, m, held] = await Promise.all([$.session.id(), read($, meta), read($, base)])
    // A fresh process, or a /clear that moved the session under this one.
    const moved = m.id !== id
    // The session left behind gets the last of its row, and counts with the others from here.
    if (moved && m.id !== undefined) await $.store.set(rowKey(m.id), share(await read($, save), held))
    // A resumed session finds its row; a hot reload over a save from before rows has progress to keep.
    const seed = moved ? parseSave(await $.store.get(rowKey(id))) : undefined
    const rest = rescan || moved ? await others($, id) : held
    const merged = await update($, save, mine =>
      total(rest, !seed ? share(mine, held) : m.id === undefined ? join(seed, share(mine, held)) : seed),
    )
    await update($, base, () => rest)
    if (moved) await update($, meta, x => ({ ...x, id }))
    await $.store.set(rowKey(id), share(merged, rest))
  }
  saving = saving.then(run, run)
  return saving
}

const seedCost = async ($: EngineInterface) => {
  const { cost } = await $.session.usage()
  await update($, meta, m => ({ ...m, lastUsd: cost?.usd }))
}

const stopAnim = () => {
  anim?.cancel()
  anim = undefined
}

const DENY_RETRIES = 3
const RETRY_MS = 500

const frame = async ($: EngineInterface) => {
  const mine = anim
  await advance($)
  checkSystem($, lastAt)
  const x = await read($, save)
  // A slow tick plays a few frames at once: the swing, the flash and the number still read.
  for (let i = animFast ? 1 : IDLE_STEPS; i > 0; i--) stepScene(scene, animFast ? 1 : 2)
  // The band's line names a skill while it plays: it is drawn anew as one starts and ends.
  if (scene.cur?.skill !== shownSkill) {
    shownSkill = scene.cur?.skill
    $.ui.invalidate('ui.render')
  }
  const view = viewOf(scene, x)
  shownExam = meetExaminer(scene, view.exam === true, shownExam)
  const shown = await $.ui.blit({ requestId: band, key: RASTER, cells: sceneCells(scene, view, cols, scheme(), drawn, drawnRows) })
  // An old frame still in flight has no say over the timer that replaced it.
  if (anim !== mine) return
  if (!shown.deny) {
    denied = 0
    startAnim($, working && isMoving(scene))
    return
  }
  stopAnim()
  // Denied before it mounted, the drawing would wait for the next change of state: ask again, a
  // few times, for a band that may just be slow to appear. Any later change still restarts it.
  if (denied++ < DENY_RETRIES) {
    $.clock.after(RETRY_MS, () => {
      $.ui.invalidate('ui.render')
    })
  }
}

// One timer, whoever asks; a band no longer mounted denies the blit and ends it, and its next
// drawing starts it again.
const startAnim = ($: EngineInterface, fast: boolean) => {
  if (anim && animFast === fast) return
  anim?.cancel()
  animFast = fast
  const timer = $.clock.every(fast ? FRAME_MS : IDLE_MS, () => {
    void frame($).catch(() => {
      if (anim === timer) stopAnim()
    })
  })
  anim = timer
}

// --- /rpg

const SKILL_IDS: Record<string, SkillId> = Object.fromEntries(SKILLS.map(id => [SKILL_NAMES[id], id]))

const buy = async ($: EngineInterface, purchase: (x: Save) => Purchase) => {
  let result: Purchase = { refused: '' }
  await update($, save, x => {
    result = purchase(x)
    return 'refused' in result ? x : result.save
  })
  return result as Purchase
}

const setOn = async ($: EngineInterface, on: boolean) => {
  await $.store.set('on', on)
  await update($, meta, m => ({ ...m, on }))
  return on ? '띠를 켰어요.' : '띠를 껐어요. 사냥은 계속돼요. /rpg 켜기 로 다시 볼 수 있어요.'
}

const command = async ($: EngineInterface, args: string): Promise<string> => {
  const [verb = '', arg = ''] = args.normalize('NFC').trim().split(/\s+/)
  const settle = async (result: Purchase, say: (x: Save, note: string) => string | Promise<string>) => {
    if ('refused' in result) return result.refused
    await sync($, false)
    return say(await read($, save), result.note)
  }
  const goldLeft = (x: Save) => `남은 골드 ${amount(x.gold)}.`

  if (verb === '') {
    // The pane where it can be placed; the report either way.
    await openPane($).catch(() => {})
    return report(await read($, save))
  }
  if (verb === '끄기' || verb === '켜기') return setOn($, verb === '켜기')
  if (verb === '테마') return setTheme($, arg)
  if (verb === '크기') return setSize($, arg)
  if (verb === '자동') return setAuto($, arg)
  const stat = STAT_VERBS[verb]
  if (stat) {
    const before = (await read($, save))[stat]
    return settle(await buy($, x => enhance(x, arg === '최대', 0, stat)), x => {
      const count = x[stat] - before
      return `${STAT_NAMES[stat]} +${x[stat]} 성공${count > 1 ? ` (${count}번)` : ''}! ${STAT_EFFECT[stat](x)}. ${goldLeft(x)}`
    })
  }
  if (verb === '뽑기') {
    const before = (await read($, save)).gear
    return settle(await buy($, x => gacha(x, Math.random)), (x, note) => {
      const big = SLOTS.find(slot => x.gear[slot] >= 3 && x.gear[slot] > before[slot])
      if (big) $.ui.toast(`${RARITY_NAMES[x.gear[big]]} ${SLOT_NAMES[big]} 획득!`)
      return `${note} ${goldLeft(x)}`
    })
  }
  if (verb === '펫') {
    const before = (await read($, save)).pet?.rarity ?? 0
    return settle(await buy($, x => petGacha(x, Math.random)), (x, note) => {
      const rarity = x.pet?.rarity ?? 0
      if (rarity >= 3 && rarity > before) $.ui.toast(`${RARITY_NAMES[rarity]} 펫 ${PET_NAMES[rarity]} 획득!`)
      return `${note} ${goldLeft(x)}`
    })
  }
  if (verb === '스킬') {
    const id = SKILL_IDS[arg]
    if (!id) return `스킬 이름을 적어 주세요: ${SKILLS.map(s => SKILL_NAMES[s]).join(', ')}`
    return settle(await buy($, x => learn(x, id)), (x, note) => `${note} 습득! 남은 포인트 ${skillPoints(x)}.`)
  }
  if (verb === '던전') return enterDungeon($, arg)
  if (verb === '환생') {
    const now = await $.clock.now()
    if (arg !== '확인') {
      const x = await read($, save)
      const result = rebirth(x, now)
      if ('refused' in result) return result.refused
      sure = true
      return `환생하면 스테이지·골드·레벨·능력치·스킬·전직이 처음으로 돌아가요. 장비·합성·펫은 그대로예요. 포인트 +${rebirthGain(x)} (1포인트마다 공격력과 골드 +10% 영구). 하려면 /rpg 환생 확인`
    }
    return settle(await buy($, x => rebirth(x, now)), async (x, note) => {
      // The day's missions count from where the hero starts over; what they paid stays paid.
      if (daily) {
        daily = { ...daily, from: dayStart(x) }
        await $.store.set(DAILY, daily)
      }
      $.ui.toast(note)
      return note
    })
  }
  if (verb === '도전') {
    const now = await $.clock.now()
    return settle(await buy($, x => challengeNow(x, now)), (_, note) => note)
  }
  if (verb === '전직' || verb === '계열') {
    const now = await $.clock.now()
    const move = verb === '전직' ? applyJob : changeLine
    return settle(await buy($, x => move(x, arg, now)), (x, note) => `${note} ${goldLeft(x)}`)
  }
  return `모르는 명령이에요: ${verb}\n/rpg 만 입력하면 상태와 명령 목록을 볼 수 있어요.`
}

// --- Quest rewards: the quest board's finished to-dos, read from ~/.quest/tasks.json.

const PAID = 'quests-paid' // every to-do id ever paid, in the store beside the rows
const QUEST_MS = 30_000
const QUEST_XP = 10 // a to-do with no xp of its own
let questing: Promise<unknown> = Promise.resolve()
let questTimer: Timer | undefined

/** The finished to-dos the file lists, each id once; none when it is missing or not JSON. */
const doneQuests = (text: string) => {
  try {
    const { tasks } = JSON.parse(text) as { tasks?: unknown }
    const done = new Map<string, number>()
    for (const t of Array.isArray(tasks) ? tasks : []) {
      if (typeof t !== 'object' || t === null || t.done !== true || typeof t.id !== 'string') continue
      done.set(t.id, typeof t.xp === 'number' && Number.isFinite(t.xp) && t.xp > 0 ? t.xp : QUEST_XP)
    }
    return done
  } catch {
    return new Map<string, number>()
  }
}

/**
 * Pays each finished to-do never paid before, once and for good: unchecking one takes nothing back.
 * The ids are written before the pay, so a failed write pays nothing rather than twice.
 */
const readQuests = ($: EngineInterface) => {
  const run = async () => {
    const home = await $.env.get('HOME')
    if (!home) return
    const done = doneQuests(await $.fs.read(`${home}/.quest/tasks.json`).catch(() => ''))
    if (done.size === 0) return
    // ponytail: two sessions reading in the same instant both find an id unpaid and both pay it;
    // the window is one store round trip. A lock in the store would close it if it ever matters.
    const kept = await $.store.get(PAID)
    const paid = new Set(Array.isArray(kept) ? kept.filter((id): id is string => typeof id === 'string') : [])
    const owed = [...done].filter(([id]) => !paid.has(id))
    if (owed.length === 0) return
    await $.store.set(PAID, [...paid, ...owed.map(([id]) => id)])
    const x = await read($, save)
    const exp = owed.reduce((sum, [, xp]) => sum + questReward(x, xp).exp, 0)
    const gold = owed.reduce((sum, [, xp]) => sum + questReward(x, xp).gold, 0)
    await play($, { type: 'reward', exp, gold })
    $.ui.toast(`퀘스트 ${owed.length}개 완료 보상: 경험치 +${amount(exp)} · 골드 +${amount(gold)}`)
    await sync($, false)
  }
  const both = async () => {
    await run()
    await checkDaily($)
  }
  // The start, each turn's end and the timer all come here: one read at a time.
  questing = questing.then(both, both)
  return questing.catch(() => {})
}

// --- 오늘의 미션: the day's start and what is paid, in the store under DAILY; checked with the quests.
// ponytail: as quest rewards, two sessions checking in the same instant can both pay a mission.

const DAILY = 'daily'
type Daily = { day: string; from: DayStart; paid: string[] }
let daily: Daily | undefined

/** The local date, as the day's key. */
const dayOf = (now: number) => {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const parseDaily = (raw: unknown): Daily | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined
  const { day, from, paid } = raw as Record<string, unknown>
  const at = from as Record<string, unknown> | null
  if (typeof day !== 'string' || !Array.isArray(paid) || typeof at !== 'object' || at === null) return undefined
  if (![at.stage, at.enhance, at.level].every(n => typeof n === 'number')) return undefined
  return { day, from: at as DayStart, paid: paid.filter((id): id is string => typeof id === 'string') }
}

/** The day's missions as the pane and the report write them. */
const missionLine = (x: Save) => {
  if (!daily) return ''
  const d = daily
  return MISSIONS.map(m => `${d.paid.includes(m.id) ? '✓' : ''}${m.name} ${missionProgress(m.id, x, d.from)}/${m.need}`).join(' · ')
}

const checkDaily = async ($: EngineInterface) => {
  const day = dayOf(await $.clock.now())
  const kept = parseDaily(await $.store.get(DAILY))
  // A new day starts from every row read in, not this session's last look at them.
  if (kept?.day !== day) await sync($)
  const x = await read($, save)
  const d = kept?.day === day ? kept : { day, from: dayStart(x), paid: [] }
  if (d !== kept) await $.store.set(DAILY, d)
  daily = d
  runs = parseRuns(await $.store.get(DUNGEON), day)
  if (kept && d !== kept) $.ui.toast(`새 하루가 시작됐어요. 던전이 열렸어요: ${runsLine()}`)
  const done = MISSIONS.filter(m => !d.paid.includes(m.id) && missionProgress(m.id, x, d.from) >= m.need)
  if (done.length === 0) return
  const all = d.paid.length + done.length === MISSIONS.length
  daily = { ...d, paid: [...d.paid, ...done.map(m => m.id)] }
  await $.store.set(DAILY, daily)
  const gold = missionReward(x) * done.length + (all ? missionBonus(x) : 0)
  await play($, { type: 'reward', exp: 0, gold })
  for (const m of done) $.ui.toast(`오늘의 미션 완료: ${m.name} ${m.need}! 골드 +${amount(missionReward(x))}`)
  if (all) $.ui.toast(`오늘의 미션 모두 완료! 보너스 골드 +${amount(missionBonus(x))}`)
  await sync($, false)
  $.ui.invalidate('ui.render')
}

// --- 던전: the day's runs used, in the store under DUNGEON apart from DAILY, which older versions rewrite.
// ponytail: as the missions, two sessions entering in the same instant can both run the last one.

const DUNGEON = 'dungeon'
type Runs = { day: string; used: Record<Dungeon, number> }
/** The day's runs as last read, for the pane. */
let runs: Runs | undefined
const runsLeft = (k: Dungeon) => DUNGEON_RUNS - (runs?.used[k] ?? 0)
const runsLine = () => DUNGEONS.map(k => `${DUNGEON_NAMES[k]} ${runsLeft(k)}/${DUNGEON_RUNS}`).join(' · ')

const parseRuns = (raw: unknown, day: string): Runs => {
  const kept = raw as Partial<Runs> | null
  const used: Partial<Record<Dungeon, unknown>> = kept?.day === day && typeof kept.used === 'object' && kept.used !== null ? kept.used : {}
  return { day, used: { gold: Number(used.gold) || 0, exp: Number(used.exp) || 0 } }
}

/** One run: counted before it pays, so a failed write pays nothing rather than twice. */
const enterDungeon = async ($: EngineInterface, arg: string) => {
  const kind = DUNGEONS.find(k => DUNGEON_NAMES[k].startsWith(arg) && arg !== '')
  runs = parseRuns(await $.store.get(DUNGEON), dayOf(await $.clock.now()))
  if (!kind) return `던전을 골라 주세요: /rpg 던전 골드 · /rpg 던전 경험치 (오늘 남은 입장: ${runsLine()})`
  if (runsLeft(kind) <= 0) return `오늘 ${DUNGEON_NAMES[kind]}은 다 들어갔어요. 내일 다시 열려요.`
  const used = { ...runs.used, [kind]: runs.used[kind] + 1 }
  runs = { ...runs, used }
  await $.store.set(DUNGEON, runs)
  const run = dungeon(await read($, save), kind, Math.random)
  await play($, { type: 'reward', exp: run.exp, gold: run.gold })
  await sync($, false)
  const paid = kind === 'gold' ? `골드 +${amount(run.gold)}` : `경험치 +${amount(run.exp)}`
  const lasted = run.fell ? `${Math.round(run.ms / 1000)}초 만에 쓰러지기까지` : `${DUNGEON_MS / 1000}초 동안`
  const note = `${DUNGEON_NAMES[kind]}: ${lasted} 몬스터 ${amount(run.kills)}마리 처치 · ${paid} (오늘 남은 입장 ${DUNGEON_RUNS - used[kind]}번)`
  $.ui.toast(note)
  return note
}

/** Advance, read the other rows in, then the command: what /rpg and every pane press go through. */
const run = async ($: EngineInterface, args: string) => {
  await advance($)
  // Gold another session spent or earned since the last save counts before anything is bought.
  await sync($)
  return command($, args)
}

// --- The pane: the same commands, a key each.

const PANE = 'rpg'
const TABS = ['성장', '장비·펫', '던전·도전', '전직·스킬'] as const
/** The pane's tab, and whether 환생 was just asked for, so [y] can confirm it; a reload clears both. */
let tab = 0
let sure = false
const LINE_KEYS: Record<JobLine, string> = { melee: 'q', magic: 'w', ranged: 'r', rogue: 'a' }

const openPane = async ($: EngineInterface) => {
  sure = false
  await update($, pane, p => ({ ...p, picking: false }))
  return $.ui.open({ id: PANE, title: 'RPG', focus: true, closeOnEscape: true })
}

const togglePane = async ($: EngineInterface) => {
  if ((await $.ui.panes()).some(p => p.id === PANE)) return $.ui.close({ id: PANE })
  await openPane($)
}

const showTab = ($: EngineInterface, next: number) => {
  tab = next
  sure = false
  $.ui.invalidate('ui.render')
}

/** A pane key: the command it stands for, its answer kept under the buttons. */
const press = async ($: EngineInterface, args: string) => {
  sure = false
  const note = await run($, args)
  await update($, pane, () => ({ picking: false, note }))
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rpg',
      description: '방치형 RPG: 상태·메뉴 보기, 강화, 체력 강화, 치명타·공격 속도, 보스 도전, 던전, 뽑기, 펫, 스킬, 전직, 환생',
      argumentHint: '[강화 [최대] | 체력 [최대] | 치명·치피·속도 [최대] | 도전 | 던전 <골드|경험치> | 뽑기 | 펫 | 스킬 <이름> | 전직 [계열] | 계열 <이름> | 환생 [확인] | 테마 [이름] | 크기 [작게|크게] | 자동 [켜기|끄기] | 끄기 | 켜기]',
    })
    // A reload over atoms an older version wrote: fields it never knew read as a fresh save's.
    await update($, save, x => ({ ...fresh(), ...x }))
    await update($, base, x => ({ ...fresh(), ...x }))
    const kept = await $.store.get('theme')
    theme = THEMES.find(t => t === kept) ?? 'system'
    const keptSize = await $.store.get('size')
    size = keptSize === 'big' ? 'big' : 'small'
    auto = (await $.store.get('auto')) === true
    tab = 0
    sure = false
    systemAt = -Infinity
    checkSystem($, await $.clock.now())
    const stored = await $.store.get('on')
    await update($, meta, m => ({ ...m, on: stored !== false }))
    // A reload comes here again mid-session: the bill it already holds is the one to count from.
    if ((await read($, meta)).lastUsd === undefined) await seedCost($)
    // The first call only starts the clock: time counts from here.
    await advance($)
    // After a reload this runs again over progress not yet saved: the row keeps it.
    await sync($)
    // The store locked: no reward this time, and the start goes on.
    await offline($).catch(() => {})
    // A band that stayed up through a reload needs drawing to start its timer again.
    $.ui.invalidate('ui.render')
    await readQuests($)
    // Its own timer, drawn or not: a to-do checked off between turns pays within half a minute.
    questTimer?.cancel()
    questTimer = $.clock.every(QUEST_MS, () => {
      void readQuests($)
      void beat($).catch(() => {})
      // 자동 typed in another session reaches this one within the half minute.
      void $.store.get('auto').then(kept => {
        auto = kept === true
      }, () => {})
    })
    return next(e)
  })

  // /clear fires no session.start, and a resumed session's bill is not this one's spending.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear') {
      await update($, meta, m => ({ ...m, lastUsd: 0 }))
      await sync($)
    }
    if (e.source === 'resume' || e.source === 'fork') await seedCost($)
    return next(e)
  })

  on('command.run', { command: 'rpg' }, async ($, e) => ({ text: await run($, e.args) }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const x = await read($, save)
    const { picking, note } = await read($, pane)
    const job = jobOf(x)
    const key = (hotkey: string, label: string, args: string) => (
      <Button key={args} plain hotkey={hotkey} label={label} onPress={() => press($, args)} />
    )
    const lines = (names: (line: JobLine) => string, except?: JobLine | null) =>
      JOB_LINES.filter(line => line !== except).map(line => key(LINE_KEYS[line], `${JOBS[line].label} ${names(line)}`, `${picking ? '계열' : '전직'} ${JOBS[line].label}`))
    const jobRow = () => {
      if (picking && job.line) {
        return [
          <Text key="label">계열 고르기 ({amount(lineChangeCost(x))}골드):</Text>,
          ...lines(line => jobName({ line, tier: job.tier }), job.line),
          <Button key="cancel" plain hotkey="x" label="취소" onPress={() => update($, pane, p => ({ ...p, picking: false }))} />,
        ]
      }
      if (job.trial) return [<Text key="label">전직 시험 중 → {jobName({ line: job.trial.line, tier: (job.tier + 1) as 1 })} · {examState(x)}</Text>]
      const change = job.line && (
        <Button key="change" plain hotkey="c" label="계열 변경" onPress={() => update($, pane, p => ({ ...p, picking: true }))} />
      )
      if (job.tier === 0) return [<Text key="label">전직 (Lv.{nextTierLevel(x)}부터):</Text>, ...lines(line => jobName({ line, tier: 1 }))]
      if (job.tier >= 3) return [<Text key="label">최종 전직 완료</Text>, change]
      return [key('j', `${job.tier + 1}차 전직 (Lv.${nextTierLevel(x)}부터)`, '전직'), change]
    }
    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold color={SCENE.crit}>
            ⚔ {jobName(job)} Lv.{levelOf(x.exp)}
          </Text>
          <Text>
            스테이지 {stageLabel(x)} · {zoneName(x)} · {clock(x)}
          </Text>
        </Box>
        <Text>
          골드 {amount(x.gold)} · 공격력 {amount(attack(x))} · 강화 +{x.enhance} · {hpText(x)} · 체력 강화 +{x.vit}
          {canApply(x) && <Text color={SCENE.crit}> · 전직 가능</Text>}
        </Text>
        {lapNote(x) !== '' && (
          <Box columnGap={2}>
            <Text color={SCENE.crit}>{lapNote(x)}</Text>
            {key('b', '지금 도전', '도전')}
          </Box>
        )}
        {missionLine(x) !== '' && <Text>오늘의 미션: {missionLine(x)}</Text>}
        <Box columnGap={2} flexWrap="wrap">
          {TABS.map((name, i) => (
            <Button key={`tab-${name}`} plain label={i === tab ? `[${name}]` : name} onPress={() => showTab($, i)} />
          ))}
          <Button key="tab-next" plain hotkey="n" label="다음 탭" onPress={() => showTab($, (tab + 1) % TABS.length)} />
        </Box>
        {tab === 0 && (
          <Box flexDirection="column">
            <Box columnGap={2} flexWrap="wrap">
              {key('e', `강화 (${amount(enhanceCost(x))}골드)`, '강화')}
              {key('m', '강화 최대', '강화 최대')}
              {key('h', `체력 강화 (${amount(enhanceCost(x, 'vit'))}골드)`, '체력')}
              {key('v', '체력 최대', '체력 최대')}
              {key('u', `자동 강화: ${auto ? '켜짐' : '꺼짐'}`, '자동')}
            </Box>
            <Box columnGap={2} flexWrap="wrap">
              {key('i', `치명타 확률 +${x.critRate} (${priceOf(x, 'critRate')})`, '치명')}
              {key('o', `치명타 피해 +${x.critDmg} (${priceOf(x, 'critDmg')})`, '치피')}
              {key('p', `공격 속도 +${x.haste} (${priceOf(x, 'haste')})`, '속도')}
            </Box>
          </Box>
        )}
        {tab === 1 && (
          <Box flexDirection="column">
            <Text>장비: {SLOTS.map(slot => `${SLOT_NAMES[slot]} ${RARITY_NAMES[x.gear[slot]]}${stars(x, slot)}`).join(' · ')}</Text>
            <Text>펫: {petText(x)}</Text>
            <Box columnGap={2} flexWrap="wrap">
              {key('g', `뽑기 (${amount(gachaCost(x))})`, '뽑기')}
              {key('k', `펫 뽑기 (${amount(petCost(x))})`, '펫')}
            </Box>
          </Box>
        )}
        {tab === 2 && (
          <Box flexDirection="column">
            <Text>상대: {foe(x)} · 최고 스테이지 {stageOf(x.best)}</Text>
            <Box columnGap={2} flexWrap="wrap">
              {key('d', `골드 던전 (${runsLeft('gold')}/${DUNGEON_RUNS})`, '던전 골드')}
              {key('f', `경험치 던전 (${runsLeft('exp')}/${DUNGEON_RUNS})`, '던전 경험치')}
            </Box>
          </Box>
        )}
        {tab === 3 && (
          <Box flexDirection="column">
            <Box columnGap={2} flexWrap="wrap">
              <Text>스킬 (포인트 {skillPoints(x)}):</Text>
              {SKILLS.map((id, i) => key(String(i + 1), `${SKILL_NAMES[id]} ${x.skills[id]}/${MAX_SKILL}`, `스킬 ${SKILL_NAMES[id]}`))}
            </Box>
            <Box columnGap={2} flexWrap="wrap">
              {jobRow()}
            </Box>
            <Box columnGap={2} flexWrap="wrap">
              <Text>환생: {rebirthText(x)}</Text>
              {stageOf(x.best) >= REBIRTH_STAGE && (sure ? key('y', '환생 확인', '환생 확인') : key('z', '환생', '환생'))}
            </Box>
          </Box>
        )}
        <Box columnGap={2}>
          {key('t', `테마: ${THEME_NAMES[theme]}`, '테마')}
          {key('s', `크기: ${SIZE_NAMES[size]}`, '크기')}
          <Text dimColor>Esc 닫기</Text>
        </Box>
        {note !== '' && <Text dimColor>{note}</Text>}
      </Box>
    )
  })

  on('session.measure', async ($, e, next) => {
    if (!e.cost) return next(e)
    const { usd } = e.cost
    const x = await read($, save)
    const rate = EXP_PER_USD * gearMult(x, 'ring') * trait(x, 'exp')
    let exp = 0
    await update($, meta, m => {
      const paid = costExp(m.lastUsd, usd, rate)
      exp = paid.exp
      return { ...m, lastUsd: paid.lastUsd }
    })
    if (exp > 0) await play($, { type: 'exp', exp })
    return next(e)
  })

  // The call goes first and never waits on the game: a failed hit is dropped, not the tool.
  on('tool.call', ($, e, next) => {
    void advance($)
      .then(() => play($, { type: 'tool' }))
      .catch(() => {})
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await advance($)
    // A save that fails costs the turn nothing: the next one writes the same row.
    if (e.agentId === undefined) {
      await sync($, false).catch(() => {})
      await readQuests($)
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await sync($, false).catch(() => {})
    await beat($).catch(() => {})
    return next(e)
  })

  // The band's rows are every plugin's together: this row makes room for another's.
  on('ui.render', { component: 'AbovePromptList' }, ($, e, next) => {
    const now = e.props.rows.reduce((sum, row) => sum + (row.plugin === 'idle-rpg' ? 0 : rowsOf(row.tree)), 0)
    if (now !== otherRows) {
      otherRows = now
      $.clock.after(0, () => {
        $.ui.invalidate('ui.render')
      })
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, meta)).on) {
      stopAnim()
      return next(e)
    }
    const x = await read($, save)
    const { level } = levelInfo(x.exp)
    const { Box, Text, Button } = $.ui.resolve(e)
    // A row of one: the menu first, so a narrow band cuts the status and keeps the button.
    const line = (
      <Box columnGap={1}>
        <Button key="menu" label="메뉴" onPress={() => togglePane($)} />
        <Text wrap="truncate-end">
        <Text bold color={SCENE.crit}>
          Lv.{level}
        </Text>
        <Text> 스테이지 {stageLabel(x)}</Text>
        <Text color={x.hurt * 2 >= maxHp(x) ? SCENE.crit : '#5fd38a'}> {hpText(x)}</Text>
        <Text bold={x.lap > 0} color={x.lap > 0 ? SCENE.crit : undefined}> {clock(x)}</Text>
        {canApply(x) && (
          <Text bold color={SCENE.crit}>
            {' '}
            [전직 가능]
          </Text>
        )}
        {scene.cur?.skill && (
          <Text bold color={SCENE.crit}>
            {' '}
            [{ACTIVE_NAMES[scene.cur.skill]}!]
          </Text>
        )}
        {trialTag(x) !== '' && (
          <Text bold color={SCENE.crit}>
            {' '}
            {trialTag(x)}
          </Text>
        )}
        <Text color="#5fd38a"> {expBar(x)}</Text>
        <Text>
          {'  '}골드 {amount(x.gold)}
          {'  '}공격력 {amount(attack(x))}
        </Text>
        <Text dimColor>
          {'  '}
          {foe(x)}
        </Text>
      </Text>
      </Box>
    )
    // Another surface's drawing says nothing about the terminal's timer.
    if (e.surface !== 'terminal') return <Box flexDirection="column">{line}</Box>
    const width = Math.min(e.props.bodyColumns, MAX_COLS)
    // A collapsed band shows nothing: no field to keep drawing.
    const layout = e.props.isCollapsed ? { size: 'small' as const, rows: 0, line: true } : bandLayout(e.props.maxRows, width, otherRows, size)
    if (layout.rows === 0) {
      stopAnim()
      return layout.line ? <Box flexDirection="column">{line}</Box> : next(e)
    }
    working = e.props.isWorking
    cols = width
    band = e.requestId
    startAnim($, working && isMoving(scene))
    const { Raster } = $.ui.resolve(e)
    drawn = layout.size
    drawnRows = layout.rows
    return (
      <Box flexDirection="column">
        <Raster
          key={RASTER}
          columns={cols}
          rows={drawnRows}
          cells={sceneCells(scene, viewOf(scene, x), cols, scheme(), drawn, drawnRows)}
        />
        {layout.line && line}
      </Box>
    )
  })
}
