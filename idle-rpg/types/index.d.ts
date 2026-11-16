export type IdleRpgSlot = 'weapon' | 'armor' | 'ring'

/** 0 없음, 1 일반, 2 희귀, 3 영웅, 4 전설 */
export type IdleRpgRarity = 0 | 1 | 2 | 3 | 4

export type IdleRpgSkillId = 'flurry' | 'crit' | 'greed'

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
    }
  }
}
