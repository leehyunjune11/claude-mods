export type Quest = {
  id: string
  sec: string
  t: string
  d?: string
  xp?: number
  boss?: boolean
  done?: boolean
  due?: string // YYYY-MM-DD 마감
  doneAt?: string // YYYY-MM-DD 완료한 날
  // quest-work 스킬이 남긴 결과
  work?: { status: 'running' | 'ready' | 'skip' | 'failed'; note: string; draft?: boolean; at?: string }
}
export type QuestFile = { date?: string; tasks: Quest[] }
// ~/.quest/hero.json: 캐릭터 색 + 화면 테마
export type Settings = {
  theme?: 'dark' | 'light' | 'system'
  heroClass?: 'knight' | 'warrior' | 'mage' | 'ranger'
  hair?: string
  eyes?: string
  skin?: string
  outfit?: string
  shirt?: string
  pants?: string
  cape?: string
  trim?: string
}

declare module 'claude-code' {
  interface PluginState {
    'quest-board': {
      data: QuestFile | null
      combo: number
      isAdding: boolean
      isPicking: boolean
      isDeleting: boolean
      settings: Settings
      isEditingHair: boolean
      picked: string[]
    }
  }
}
