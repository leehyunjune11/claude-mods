export type TaskStatus = 'pending' | 'in_progress' | 'completed'
export type Task = { id: string; subject: string; status: TaskStatus; activeForm?: string }
export type DeskState = 'working' | 'idle' | 'done' | 'waiting'
export type AgentRow = { id: string; type: string; description: string; status: string }
// 셸·모니터·워크플로처럼 $.agent.list() 에 안 잡히는 백그라운드 작업
export type BgTask = { id: string; type: string; description: string }
export type LogLine = { ok: boolean; text: string; secs: number }
export type Change = { file: string; add: number; del: number }
export type Git = { branch: string; dirty: number; isRisky: boolean }
export type Streak = { command: string; n: number }
// isDone: 끝난 뒤 60초 동안 결과만 띄우는 상태
export type Ci = { line: string; pct: number; now: string; isDone: boolean }
export type Day = { files: Change[]; tasks: string[] }
// 지금 도구가 보고 있는 파일: tool_use_id 로 하나씩 지운다
export type Reading = { id: string; agentId: string; file: string; tool: string }
// /replay 한 칸: 파일 경로와 unified diff
export type EditRec = { file: string; patch: string }
// 입력창 위 세션 정보 띠
export type Sess = { pct?: number; limits: { name: string; pct: number }[]; turns: number; input: number; output: number; read: number; write: number; lastAt: number }
// 패널 「할 일 메모」 한 줄: 모드 폴더 todos.json 에 남아 세션을 넘어 유지된다
export type Memo = { text: string; note?: string; addedAt?: string; project?: string }
export type Desk = { id: string; name: string; state: DeskState; activity: string; tools: number }

declare module 'claude-code' {
  interface PluginState {
    office: { tasks: Shaped<Task[]>; desks: Shaped<Desk[]>; frame: number; agents: Shaped<AgentRow[]>; logs: Shaped<Record<string, LogLine[]>>; changes: Shaped<Change[]>; picked: string | null; turnStart: number; fails: number; streaks: Shaped<Record<string, Streak>>; warn: string | null; git: Shaped<Git | null>; ci: Shaped<Ci | null>; recap: string | null; bg: Shaped<BgTask[]>; reading: Shaped<Reading[]>; edits: Shaped<EditRec[]>; lastEdits: Shaped<EditRec[]>; replayAt: number; sess: Shaped<Sess | null>; memo: Shaped<Memo[]> }
  }
}
