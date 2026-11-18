export type IdleRpgSlot = 'weapon' | 'armor' | 'ring'

/** 0 없음, 1 일반, 2 희귀, 3 영웅, 4 전설 */
export type IdleRpgRarity = 0 | 1 | 2 | 3 | 4

export type IdleRpgSkillId = 'flurry' | 'crit' | 'greed'

export type IdleRpgJobLine = 'melee' | 'magic' | 'ranged' | 'rogue'

/** 0 인턴, then 1차 / 2차 / 3차 전직. */
export type IdleRpgTier = 0 | 1 | 2 | 3

export type IdleRpgJob = {
  /** null iff tier 0 (인턴). */
  line: IdleRpgJobLine | null
  tier: IdleRpgTier
  /** A pending 전직 시험: the examiner's hp, fixed when applied. Absent = none pending. */
  trial?: { line: IdleRpgJobLine; hp: number }
  /** When line, tier or trial last changed (ms); breaks ties between rows. */
  at: number
}

/**
 * What the game is played on, and each session's row in the store (`s:<session id>`): there exp,
 * gold, 강화 and skills are that session's own share, which add up across rows. Level and stage are
 * derived.
 */
export type IdleRpgSave = {
  v: 1
  /** Total exp ever earned. */
  exp: number
  gold: number
  /** How far the hero is: kills that moved on. The 10th of each stage is its boss. */
  kills: number
  /** How many times 강화 was bought. */
  enhance: number
  gear: Record<IdleRpgSlot, IdleRpgRarity>
  /** 0..5 each. */
  skills: Record<IdleRpgSkillId, number>
  /** Damage already dealt to the current monster. */
  dmg: number
  /** How many times 체력 강화 was bought; a share like `enhance`. */
  vit: number
  /** The furthest `kills` ever reached: what the day's stage mission and the news count from. */
  best: number
  /** Damage the hero has taken since the stage began; at max hp the hero falls. */
  hurt: number
  /** Time spent in this stage's attempt (ms): a challenge past the limit fails. */
  ms: number
  /** Kills left of a retreat lap, run with no time limit; 0 = challenging the stage. */
  lap: number
  /** When the position (kills, dmg, hurt, ms, lap) last moved (ms): rows take the latest whole. */
  moved: number
  /**
   * The hero's job, absolute like the position: rows join it whole, the higher tier and then the
   * later change winning. Absent on saves from before jobs, and read as 인턴.
   */
  job?: IdleRpgJob
  /**
   * Each slot's 합성 level: a 뽑기 no better than what is worn adds one. Rows join it by the higher
   * per slot. Absent on saves from before it, and read as 0.
   */
  forge?: Record<IdleRpgSlot, number>
}

export type IdleRpgMeta = {
  /** Whether the band is drawn; /rpg 끄기 and 켜기 flip it, $.store keeps it. */
  on: boolean
  /** The session's cumulative cost as of the last session.measure; exp comes from the rise past it. */
  lastUsd?: number
  /** The session whose row `save` less `base` is. */
  id?: string
}

declare module 'claude-code' {
  interface PluginState {
    'idle-rpg': {
      save: Shaped<IdleRpgSave>
      /** Every other session's share joined, as last read from the store. */
      base: Shaped<IdleRpgSave>
      meta: Shaped<IdleRpgMeta>
      /** The /rpg pane's own: whether [c] is picking a line, and the last press's answer. */
      pane: { picking: boolean; note: string }
    }
  }
}
