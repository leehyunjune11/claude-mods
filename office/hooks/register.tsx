import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { AgentRow, BgTask, Change, Ci, Day, Desk, EditRec, Git, LogLine, Memo, Reading, Sess, Streak, Task } from '../types'

const PANE = 'office'
const MAIN = 'main'
const tasks = atom({ plugin: 'office', key: 'tasks' } as const, [], { shape: 'tasks-1' })
const desks = atom({ plugin: 'office', key: 'desks' } as const, [], { shape: 'desks-1' })
const frame = atom({ plugin: 'office', key: 'frame' } as const, 0)
const agents = atom({ plugin: 'office', key: 'agents' } as const, [], { shape: 'agents-1' })
const logs = atom({ plugin: 'office', key: 'logs' } as const, {}, { shape: 'logs-1' })
const changes = atom({ plugin: 'office', key: 'changes' } as const, [], { shape: 'changes-1' })
const picked = atom({ plugin: 'office', key: 'picked' } as const, null as string | null)
// 이번 턴에 실패한 도구 호출 수
const fails = atom({ plugin: 'office', key: 'fails' } as const, 0)
// 에이전트별로 같은 Bash 명령이 연달아 실패한 횟수
const streaks = atom({ plugin: 'office', key: 'streaks' } as const, {} as Record<string, Streak>, { shape: 'streaks-1' })
// 3번 연속 실패해 띠에 경고 중인 명령
const warn = atom({ plugin: 'office', key: 'warn' } as const, null as string | null)
const git = atom({ plugin: 'office', key: 'git' } as const, null as Git | null, { shape: 'git-1' })
const ci = atom({ plugin: 'office', key: 'ci' } as const, null as Ci | null, { shape: 'ci-2' })
// 아침 첫 세션에 띠에 띄우는 지난 작업일 요약
// Stop 이 알려 준 진행 중 백그라운드 작업 (서브에이전트는 agents 가 보여 주므로 뺀다)
const bg = atom({ plugin: 'office', key: 'bg' } as const, [] as BgTask[], { shape: 'bg-1' })
const recap = atom({ plugin: 'office', key: 'recap' } as const, null as string | null)
// 셸·모니터·워크플로 작업만 남긴다 (서브에이전트는 agents 가 보여 준다)
const snapshot = async ($: EngineInterface, tasks: { id: string; type: string; description: string; command?: string; name?: string }[] = []) => {
  const rows = tasks
    .filter(t => t.type !== 'subagent')
    .map(t => ({ id: t.id, type: t.type, description: t.name ?? t.command ?? t.description }))
  await update($, bg, () => rows)
}
// 나중에 할 일 메모: 모드 폴더 todos.json([{ text, note?, addedAt?, project? }], addedAt 은 추가한 날 YYYY-MM-DD, project 는 묶을 폴더 이름). 파일을 직접 고쳐도 되고 /office todo·done 으로도 바꾼다
// 읽을 때와 쓸 때 프로젝트 묶음 순서로 정리하므로 배열 위치 + 1 이 곧 화면 번호이자 done 번호다
const memo = atom({ plugin: 'office', key: 'memo' } as const, [] as Memo[], { shape: 'memo-1' })
const memoFile = ($: EngineInterface) => `${$.plugin.root}/todos.json`
// 프로젝트가 처음 나온 순서로 안정 정렬, project 없는 메모는 맨 뒤
const memoOrder = (list: Memo[]) => {
  const order = [...new Set(list.map(m => m.project).filter(Boolean))]
  const rank = (m: Memo) => (m.project ? order.indexOf(m.project) : order.length)
  return [...list].sort((a, b) => rank(a) - rank(b))
}
// i 번째 메모 위에 올 제목: 프로젝트가 바뀌면 프로젝트 이름과 날짜를 다시, 같은 프로젝트면 날짜가 바뀔 때만
const memoHead = (list: Memo[], i: number) => {
  const m = list[i]!, prev = list[i - 1]
  const title = !prev || (m.project || '') !== (prev.project || '') ? m.project || '기타' : undefined
  return { title, date: m.addedAt && (title || m.addedAt !== prev?.addedAt) ? m.addedAt : undefined }
}
const loadMemo = async ($: EngineInterface) => {
  const text = await $.fs.read(memoFile($)).catch(() => '[]')
  const list = (() => { try { return JSON.parse(text as string) } catch { return [] } })()
  // 손으로 고친 파일의 잘못된 project 는 기타로 돌린다 (객체가 그대로 가면 패널 전체가 안 그려진다)
  const clean = (m: Memo): Memo => (typeof m.project === 'string' ? m : { ...m, project: undefined })
  await update($, memo, () => (Array.isArray(list) ? memoOrder(list.filter((m): m is Memo => typeof m?.text === 'string').map(clean)) : []))
}
const saveMemo = async ($: EngineInterface, list: Memo[]) => {
  const sorted = memoOrder(list)
  await $.fs.write(memoFile($), JSON.stringify(sorted, null, 2) + '\n')
  await update($, memo, () => sorted)
}
const PROTECTED = new Set(['main', 'master', 'dev'])
// 실행 실패는 undefined 로 삼킨다: 훅은 절대 던지지 않는다
const run = ($: EngineInterface, argv: string[]) => $.process.run(argv, { timeoutMs: 10000 }).catch(() => undefined)
const stdout = async ($: EngineInterface, argv: string[]) => {
  const r = await run($, argv)
  return r?.exitCode === 0 ? r.stdout : undefined
}
// session.start 에서 한 번 정한다: 다시 시작하면 이전 타이머를 끄고, 폴더 이름·worktree 여부를 다시 잰다
let timers: Timer[] = []
let folder = '?'
let project: string | undefined
let cwd = ''
let isWorktree = false
let busy: Promise<void> | undefined
// CI 추적은 도구 호출 하나와 따로 산다: 모듈에 하나만 두고, 새 gh 명령이 오면 갈아탄다
let ciTimer: Timer | undefined
let ciClear: Timer | undefined
const notify = ($: EngineInterface, text: string) => void $.ui.notify(text).catch(() => undefined)

// 세션 폴더의 git 브랜치·변경 수. git 이 저장소가 아니라고 하면(128) null, 그 밖의 실패는 이전 값을 둔다
const readGit = async ($: EngineInterface) => {
  const r = await run($, ['git', 'status', '--porcelain=v1', '-b'])
  if (r?.exitCode === 128) return void (await update($, git, () => null))
  if (r?.exitCode !== 0) return
  const [head = '', ...rest] = r.stdout.split('\n')
  // ponytail: `## No commits yet on x` 와 `## HEAD (no branch)` 는 마지막·첫 낱말로 어림한다
  const branch = head.startsWith('## No commits yet on ') ? head.slice(21) : (head.slice(3).split('...')[0] ?? '').split(' ')[0] ?? ''
  const dirty = rest.filter(Boolean).length
  await update($, git, () => ({ branch, dirty, isRisky: dirty > 0 && PROTECTED.has(branch) && !isWorktree }))
}
// 도는 중이면 그 결과를 같이 기다린다: Edit/Bash 가 몰려도 git 은 한 번만
const refreshGit = ($: EngineInterface) => (busy ??= readGit($).catch(() => undefined).finally(() => (busy = undefined)))

// gh run view 의 jobs 를 띠 한 줄·진행률로
type Job = { name: string; status: string; conclusion: string; steps?: { name: string; status: string }[] }
const PASSED = ['success', 'skipped', 'neutral']
const ciState = (workflow: string, jobs: Job[]): Ci => {
  const job = jobs.find(j => j.status === 'in_progress')
  const steps = job?.steps ?? []
  const step = steps.find(s => s.status === 'in_progress')
  const now = job ? `${job.name}${step ? ` ▶ ${step.name} (${steps.indexOf(step) + 1}/${steps.length})` : ''}` : ''
  const ok = jobs.filter(j => j.conclusion === 'success').length
  const bad = jobs.filter(j => j.status === 'completed' && !PASSED.includes(j.conclusion)).length
  const left = jobs.filter(j => j.status !== 'completed').length
  // 끝난 job 은 1, 도는 job 은 끝난 step 비율만큼
  const partial = jobs
    .filter(j => j.status === 'in_progress' && j.steps?.length)
    .reduce((n, j) => n + j.steps!.filter(s => s.status === 'completed').length / j.steps!.length, 0)
  const pct = jobs.length ? ((jobs.length - left + partial) / jobs.length) * 100 : 0

  return { line: `CI · ${workflow}${now ? ` · ${now}` : ''} · ✓${ok} ✗${bad} ⏳${left}`, pct, now, isDone: false }
}
const CI_COMMAND = /\bgh (run (watch|view)|pr checks)\b/
// 10초마다 run 을 읽다가 끝나면 알리고 결과를 60초 띄운다. 60분이 지나면 그만둔다.
// ponytail: id 가 없으면 지금 브랜치의 마지막 run 하나만 본다. 브랜치에 run 이 여럿 동시에 돌면 놓친다.
type Run = { workflowName?: string; status?: string; conclusion?: string; jobs?: Job[] }
const viewRun = async ($: EngineInterface, id: string) => {
  const out = await stdout($, ['gh', 'run', 'view', id, '--json', 'workflowName,status,conclusion,jobs'])
  return out ? (JSON.parse(out) as Run) : undefined
}
// 새 대상이 살아 있는(안 끝난) run 일 때만 지금 추적기를 갈아탄다: 끝난 run 을 들여다봐도 도는 추적은 그대로
const trackCi = async ($: EngineInterface, command: string) => {
  const tail = command.match(/\bgh run (?:watch|view)\b([^;&|]*)/)?.[1]
  if (tail !== undefined && /--job\b/.test(tail)) return
  // 플래그가 앞에 와도(`--log-failed 123`, `-R o/r 123`) 처음 나오는 숫자 낱말이 run id
  let runId = tail?.split(/\s+/).find(t => /^\d+$/.test(t))
  let workflow = ''
  if (!runId) {
    // `gh pr checks 556` 는 세션 폴더가 아니라 그 PR 의 브랜치(대개 worktree)에서 돈다
    // ponytail: 번호 없는 `cd <worktree> && gh pr checks` 는 아직 세션 폴더 브랜치를 본다
    const pr = command.match(/\bgh pr checks\b([^;&|]*)/)?.[1]?.split(/\s+/).find(t => /^\d+$/.test(t))
    let branch = pr ? (await stdout($, ['gh', 'pr', 'view', pr, '--json', 'headRefName', '-q', '.headRefName']))?.trim() : (await read($, git))?.branch
    if (!branch && !pr) {
      await refreshGit($)
      branch = (await read($, git))?.branch
    }
    const list = branch && (await stdout($, ['gh', 'run', 'list', '--branch', branch, '--limit', '1', '--json', 'databaseId,status,name']))
    const latest = list ? (JSON.parse(list) as { databaseId: number; status: string; name: string }[])[0] : undefined
    if (!latest || latest.status === 'completed') return
    ;[runId, workflow] = [String(latest.databaseId), latest.name]
  }
  const id = runId
  const first = await viewRun($, id)
  if (!first || first.status === 'completed') return

  ciTimer?.cancel()
  ciClear?.cancel()
  const startedAt = await $.clock.now()
  const show = async (data: Run) => {
    const wf = data.workflowName || workflow
    const jobs = data.jobs ?? []
    if (data.status !== 'completed') return void (await update($, ci, () => ciState(wf, jobs)))
    timer.cancel()
    const failed = jobs.find(j => j.status === 'completed' && !PASSED.includes(j.conclusion))?.name
    const isOk = data.conclusion === 'success'
    notify($, isOk ? `CI 끝: ${wf} 성공` : `CI 실패: ${wf}${failed ? ` · ${failed}` : ''}`)
    const line = isOk ? `CI · ${wf} · ✓ 성공` : `CI · ${wf} · ✗ 실패${failed ? ` (${failed})` : ''}`
    if (timer !== ciTimer) return
    await update($, ci, () => ({ line, pct: 100, now: '', isDone: true }))
    ciClear?.cancel()
    ciClear = $.clock.after(60000, () => void update($, ci, () => null))
  }
  const poll = async () => {
    // 60분이 넘으면 그만두고 줄도 지운다
    if ((await $.clock.now()) - startedAt > 3600000) {
      timer.cancel()
      if (timer === ciTimer) await update($, ci, () => null)
      return
    }
    const data = await viewRun($, id)
    if (data && timer === ciTimer) await show(data)
  }
  const timer = $.clock.every(10000, () => void poll().catch(() => undefined))
  ciTimer = timer
  await show(first)
}

// 오늘 한 일: $.store 에 로컬 날짜(YYYY-MM-DD) 키로 쌓는다
const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// 이 세션 안에서는 줄을 세워 하나씩 쓴다. 도구 결과는 저장을 기다리지 않는다.
// ponytail: 세션 여러 개가 같은 날짜 키를 동시에 쓰면 하나를 잃을 수 있다. 막으려면 세션별 키로 나눠 읽을 때 합친다.
let dayQ: Promise<unknown> = Promise.resolve()
const logDay = ($: EngineInterface, edit: (d: Day) => Day) => {
  dayQ = dayQ
    .then(async () => {
      const key = dayKey(await $.clock.now())
      const day = ((await $.store.get(key)) as Day | undefined) ?? { files: [], tasks: [] }
      const next = edit(day)
      await $.store.set(key, { files: next.files.slice(-100), tasks: next.tasks.slice(-100) })
    })
    .catch(() => undefined)
}
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/
// 오늘보다 앞선 날짜 키 가운데 가장 최근 것 = 지난 작업일
// 30일 정리로 곧 지워질 날은 고르지 않는다
const prevDay = async ($: EngineInterface) => {
  const ms = await $.clock.now()
  const [today, cutoff] = [dayKey(ms), dayKey(ms - 30 * 86400000)]
  return (await $.store.keys()).filter(k => DATE_KEY.test(k) && k < today && k >= cutoff).sort().pop()
}
const dayText = async ($: EngineInterface, key: string, title: string) => {
  const day = ((await $.store.get(key).catch(() => undefined)) as Day | undefined) ?? { files: [], tasks: [] }
  const add = day.files.reduce((n, f) => n + f.add, 0)
  const del = day.files.reduce((n, f) => n + f.del, 0)

  return [
    `${title}(${key}) 한 일`,
    `바뀐 파일 ${day.files.length}개 · +${add} −${del}`,
    ...day.files.map(f => `  ${f.file} +${f.add} −${f.del}`),
    `끝낸 일 ${day.tasks.length}개`,
    ...day.tasks.map(t => `  ✓ ${t}`),
  ].join('\n')
}
const addTasks = ($: EngineInterface, subjects: string[]) => {
  if (subjects.length) logDay($, d => ({ ...d, tasks: [...d.tasks, ...subjects.filter(s => !d.tasks.includes(s))] }))
}
// 초록 → 노랑 → 빨강: 칸이 오른쪽일수록 많이 쓴 것
const GRAD = ['#22c55e', '#84cc16', '#eab308', '#f97316', '#ef4444']
// 칸마다 그라디언트 색을 칠하고, tick 이 있으면(일하는 중) 밝은 띠가 왼쪽에서 오른쪽으로 흐른다
const gauge = (Text: any, pct: number, width: number, tick: number) => {
  const filled = Math.round((width * Math.min(100, Math.max(0, pct))) / 100)
  const glow = tick >= 0 && filled > 0 ? tick % (filled + 3) : -9
  return Array.from({ length: width }, (_, i) =>
    i < filled ? (
      <Text color={Math.abs(i - glow) <= 1 ? '#4fc3f7' : GRAD[Math.min(GRAD.length - 1, Math.floor((i / width) * GRAD.length))]}>█</Text>
    ) : (
      <Text dimColor>░</Text>
    ),
  )
}
const lines = (text: unknown) => (typeof text === 'string' && text ? text.split('\n').length : 0)
const turnStart = atom({ plugin: 'office', key: 'turnStart' } as const, 0)
// 흰 배경용 #c6dbda 게이지: 아주 옅은 홈 위로 #c6dbda 계열이 차고, 진한 청록 빛이 흐른다
const BLUE = ['#a9c8c6', '#b3cfcd', '#bcd5d3', '#c6dbda', '#c6dbda']
const TRACK = '#edf3f3'
const BAR = 24
// 0~100% 만큼 왼쪽부터 차고, 찬 부분 위로 진한 빛이 흐른다
// pct 가 없으면(진행률을 모름) 채우지 않고 빛 조각만 홈 위를 왕복한다: 가짜 진행률을 보여 주지 않는다
const glowBar = (Text: any, tick: number, pct: number | undefined) => {
  if (pct === undefined) {
    const span = BAR - 4
    const at = tick % (span * 2)
    const head = at < span ? at : span * 2 - at
    return Array.from({ length: BAR }, (_, i) => <Text color={i >= head && i < head + 4 ? '#6e9e9b' : TRACK}>━</Text>)
  }
  const filled = Math.round((BAR * Math.min(100, Math.max(0, pct))) / 100)
  const head = tick % (filled + 4)
  return Array.from({ length: BAR }, (_, i) => {
    if (i >= filled) return <Text color={TRACK}>━</Text>
    const isGlow = Math.abs(i - head) <= 1
    return <Text color={isGlow ? '#6e9e9b' : BLUE[Math.min(BLUE.length - 1, Math.floor((i / BAR) * BLUE.length))]}>━</Text>
  })
}
// 75s → 1m 15s
const elapsed = (secs: number) => (secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`)
const LIVE = new Set(['pending', 'running', 'waiting'])

const short = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

// 도구 호출 하나를 책상에 띄울 한 줄로
const label = (e: { tool: string }) => {
  const args = e as unknown as Record<string, unknown>
  const detail = [args.command, args.file_path, args.pattern, args.description, args.url, args.subject]
    .find(v => typeof v === 'string') as string | undefined
  const tail = detail?.split('/').pop() ?? ''

  return tail ? `${e.tool}: ${tail}` : e.tool
}

const setDesk = (
  $: EngineInterface,
  id: string,
  patch: Partial<Desk>,
  name = id === MAIN ? 'Claude' : 'agent',
) =>
  update($, desks, list => {
    const found = list.some(d => d.id === id)
    const next = found ? list : [...list, { id, name, state: 'idle' as const, activity: '', tools: 0 }]

    return next.map(d => (d.id === id ? { ...d, ...patch } : d))
  })

// ---- 지금 보는 파일 · /replay · 세션 정보 ----
const reading = atom({ plugin: 'office', key: 'reading' } as const, [] as Reading[], { shape: 'reading-1' })
// 이번 프롬프트 구간의 수정, 직전 구간의 수정
const edits = atom({ plugin: 'office', key: 'edits' } as const, [] as EditRec[], { shape: 'edits-1' })
const lastEdits = atom({ plugin: 'office', key: 'lastEdits' } as const, [] as EditRec[], { shape: 'edits-1' })
const replayAt = atom({ plugin: 'office', key: 'replayAt' } as const, 0)
const sess = atom({ plugin: 'office', key: 'sess' } as const, null as Sess | null, { shape: 'sess-2' })
const REPLAY = 'office-replay'
const LOOK = /^(Read|Edit|Write|Grep|Glob)$/
const replayList = async ($: EngineInterface) => {
  const now = await read($, edits)
  return now.length ? now : read($, lastEdits)
}
type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }
// 도구 결과의 structuredPatch(실제 줄 번호)로 diff 를 만든다. 새 파일 Write 는 전부 +. Code 는 \r 를 받지 않는다.
const toPatch = (result: Record<string, any> | undefined, content: unknown) => {
  const hunks: Hunk[] = Array.isArray(result?.structuredPatch) ? result.structuredPatch : []
  let text = hunks.map(h => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines].join('\n')).join('\n')
  if (!text && result?.type === 'create' && typeof content === 'string' && content) {
    const body = content.replace(/\n$/, '').split('\n')
    text = [`@@ -0,0 +1,${body.length} @@`, ...body.map(l => `+${l}`)].join('\n')
  }
  return text.replace(/\r/g, '')
}
// ponytail: 캐시 TTL 1시간 고정(이 사용자의 캐시 쓰기 99.9% 가 1h). 5분 TTL 환경이면 5 * 60000 으로 바꾼다.
const CACHE_TTL = 3600000
const LIMITS: Record<string, string> = { five_hour: '5h', seven_day: '7d' }
const tokens = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : `${v}`)
// 많이 쓸수록 노랑 → 빨강, 여유 있으면 색 없이 흐리게
const level = (pct: number | undefined, warn: number, alarm: number) =>
  pct === undefined || pct < warn ? undefined : pct < alarm ? 'yellow' : 'red'
// 띠 한 줄의 조각들: 앞쪽(ctx·캐시·한도)은 위험할 때만 색, 뒤쪽(턴·토큰)은 늘 흐리게
const sessParts = (s: Sess, now: number): { text: string; color?: string }[] => {
  const left = CACHE_TTL - (now - s.lastAt)
  const cache =
    left <= 0 ? { text: '캐시 만료' }
    : left < 60000 ? { text: `캐시 ${Math.ceil(left / 1000)}초`, color: 'red' }
    : { text: `캐시 ${Math.floor(left / 60000)}분`, color: left < 5 * 60000 ? 'yellow' : undefined }
  const all = s.input + s.read + s.write
  const hit = all ? ` 캐시적중 ${Math.round((s.read / all) * 100)}%` : ''
  return [
    { text: `ctx ${s.pct ?? '?'}%`, color: level(s.pct, 60, 80) },
    cache,
    ...s.limits.map(l => ({ text: `${l.name} ${l.pct}%`, color: level(l.pct, 70, 90) })),
    { text: `턴 ${s.turns} · in ${tokens(all)} out ${tokens(s.output)}${hit}` },
  ]
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'office', description: '에이전트 오피스 패널 열기 (todo [@폴더명] <내용> · done <번호> 로 프로젝트별 할 일 메모)' })
    await $.command.register({ name: 'replay', description: '직전 턴의 파일 수정을 하나씩 다시 보기' })
    await setDesk($, MAIN, { state: 'idle', activity: '대기 중' })
    void $.ui.open({ id: PANE, title: 'Agent Office' })
    // 일하는 책상이 있을 때만 프레임을 넘겨 타이핑 애니메이션
    ;[...timers, ciTimer, ciClear].forEach(t => t?.cancel())
    ciTimer = ciClear = undefined
    // 핫 리로드로 지난 환경의 CI 감시가 끊겼으면 줄이 남지 않게 비운다
    await update($, ci, () => null)
    await update($, recap, () => null)
    // 리로드로 끊긴 Read 의 finally 는 돌지 않으니 지금 보는 파일·세션 누적도 비운다
    await update($, reading, () => [])
    await update($, sess, () => null)
    void loadMemo($).catch(() => undefined)
    cwd = e.cwd
    folder = e.cwd.split('/').pop() || '?'
    const dirs = await stdout($, ['git', 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'])
    const [dir, common] = (dirs ?? '').trim().split('\n')
    isWorktree = dirs !== undefined && dir !== common
    // worktree 에서도 저장소 이름이 되도록 --git-common-dir 의 /.git 앞 폴더를 쓴다
    project = common?.replace(/\/\.git$/, '').split('/').pop() || folder
    void (async () => {
      // 9시가 넘은 그날 첫 세션이면 지난 작업일 요약을 띠에 띄운다
      const ms = await $.clock.now()
      const prev = await prevDay($)
      if (e.isInteractive && new Date(ms).getHours() >= 9 && prev && (await $.store.get('recapShown')) !== dayKey(ms)) {
        const day = (await $.store.get(prev)) as Day | undefined
        if (day && (day.files.length || day.tasks.length)) {
          await update($, recap, () => `☀ 지난 작업일(${prev}): 파일 ${day.files.length}개 · 끝낸 일 ${day.tasks.length}개 — /office yesterday`)
        }
      }
      // 30일 넘은 날짜 키는 지운다 (recapShown 은 날짜 모양이 아니라 남는다)
      const cutoff = dayKey(ms - 30 * 86400000)
      for (const k of await $.store.keys()) if (DATE_KEY.test(k) && k < cutoff) await $.store.delete(k)
    })().catch(() => undefined)
    const frames = $.clock.every(150, async () => {
      if ((await read($, desks)).some(d => d.state === 'working' || d.state === 'waiting')) {
        await update($, frame, n => (n + 1) % 840)
      }
    })
    // ponytail: 3초마다 에이전트 목록을 다시 읽는다. 엔진이 에이전트 변화 이벤트를 주면 그쪽으로 바꾼다.
    const roster = $.clock.every(3000, async () => {
      const list = await $.agent.list().catch(() => [])
      const rows: AgentRow[] = list.map(a => ({ id: a.id, type: a.type, description: a.description, status: a.status }))
      await update($, agents, () => rows)
      const live = rows.filter(r => LIVE.has(r.status)).length
      const jobs = (await read($, bg)).length
      const parts = [live && `에이전트 ${live}개`, jobs && `백그라운드 ${jobs}개`].filter(Boolean)
      $.ui.status(parts.length ? `${parts.join(' · ')} 실행 중` : undefined)
      // 세션 정보 띠의 캐시 남은 시간을 3초마다 다시 그린다
      if (await read($, sess)) $.ui.invalidate('ui.render')
    })
    // git 칩은 10초마다, 그리고 Edit/Write/Bash 뒤에 다시 읽는다
    void refreshGit($)
    timers = [frames, roster, $.clock.every(10000, () => void refreshGit($))]

    return next(e)
  })

  on('command.run', { command: 'office' }, async ($, e) => {
    const sub = e.args.trim()
    if (sub === 'todo' || sub.startsWith('todo ')) {
      await loadMemo($)
      const text = sub.slice(4).trim()
      const list = await read($, memo)
      if (!text) return { text: list.length ? list.map((m, i) => {
        const { title, date } = memoHead(list, i)
        return `${title ? `${i ? '\n' : ''}${title}\n` : ''}${date ? `${title ? '' : '\n'}${date}\n` : ''}${i + 1}. ${m.text}`
      }).join('\n') : '할 일 메모가 없어요. /office todo <내용> 으로 추가해요.' }
      const at = text.match(/^@(\S*)\s*([\s\S]*)$/)
      if (at && !(at[1] && at[2])) return { text: '폴더명과 내용을 함께 적어 주세요. /office todo @폴더명 <내용>' }
      const item: Memo = { text: at?.[2] ?? text, addedAt: dayKey(await $.clock.now()), project: at?.[1] ?? project }
      // 새 메모가 묶음 안으로 들어가 맨 끝이 아닐 수 있으니 정리한 뒤의 자리를 알려 준다
      const next = memoOrder([...list, item])
      await saveMemo($, next)
      return { text: `할 일 메모에 추가했어요 (${next.indexOf(item) + 1}번).` }
    }
    if (sub.startsWith('done ')) {
      // 다른 세션이 메모를 더하면 묶음 안으로 끼어들어 번호가 밀린다. 사용자가 본 번호와 다르면 지우지 않는다
      const seen = await read($, memo)
      await loadMemo($)
      const n = Number(sub.slice(5).trim()), list = await read($, memo)
      if (!Number.isInteger(n) || n < 1 || n > list.length) return { text: `번호를 1~${list.length} 사이로 적어 주세요.` }
      if (seen.length !== list.length || seen[n - 1]?.text !== list[n - 1]?.text) return { text: '목록이 바뀌어서 지우지 않았어요. /office todo 로 번호를 다시 확인해 주세요.' }
      await saveMemo($, list.filter((_, i) => i !== n - 1))
      return { text: `${n}번 메모를 지웠어요: ${list[n - 1]?.text ?? ""}` }
    }
    if (sub === 'today') {
      await dayQ
      return { text: await dayText($, dayKey(await $.clock.now()), '오늘') }
    }
    if (sub === 'yesterday') {
      const key = await prevDay($).catch(() => undefined)
      return { text: key ? await dayText($, key, '지난 작업일') : '지난 작업일 기록이 없어요.' }
    }
    await $.ui.open({ id: PANE, title: 'Agent Office' })

    return { text: 'Agent Office 패널을 열었어요.' }
  })

  on('prompt.submit', async ($, e, next) => {
    // 새 요청이 오면 끝난 서브에이전트 책상은 비운다
    await update($, desks, list => list.filter(d => d.id === MAIN || d.state !== 'done'))
    await update($, changes, () => [])
    await update($, warn, () => null)
    if ((await read($, ci))?.isDone) {
      ciClear?.cancel()
      await update($, ci, () => null)
    }
    if (await read($, recap)) {
      await update($, recap, () => null)
      void $.store.set('recapShown', dayKey(await $.clock.now())).catch(() => undefined)
    }

    return next(e)
  })

  // ponytail: 목록은 턴이 끝날 때만 갱신된다. 작업이 끝나면 알림이 새 턴을 열고 그 Stop 이 다시 채운다.
  on('classic.Stop', async ($, e, next) => {
    await snapshot($, e.background_tasks)
    return next(e)
  })
  on('classic.SubagentStop', async ($, e, next) => {
    await snapshot($, e.background_tasks)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      const now = await $.clock.now()
      await update($, turnStart, () => now)
      await update($, fails, () => 0)
      // 사용자 프롬프트만 /replay 구간을 나눈다. 백그라운드 알림이 연 턴(text "")은 같은 구간
      if (e.text) {
        const prev = await read($, edits)
        await update($, lastEdits, () => prev)
        await update($, edits, () => [])
      }
    }
    await setDesk($, e.agentId ?? MAIN, { state: 'working', activity: '생각 중' })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      const u = await $.session.usage().catch(() => undefined)
      const now = await $.clock.now()
      const t = e.usage
      await update($, sess, s => ({
        pct: u?.context?.percent ?? s?.pct,
        limits: (u?.rateLimits ?? []).map(l => ({ name: LIMITS[l.kind] ?? l.kind, pct: Math.round(l.percentUsed) })),
        turns: (s?.turns ?? 0) + 1,
        input: (s?.input ?? 0) + (t?.input_tokens ?? 0),
        output: (s?.output ?? 0) + (t?.output_tokens ?? 0),
        read: (s?.read ?? 0) + (t?.cache_read_input_tokens ?? 0),
        write: (s?.write ?? 0) + (t?.cache_creation_input_tokens ?? 0),
        lastAt: t ? now : (s?.lastAt ?? now),
      }))
    }
    await setDesk($, e.agentId ?? MAIN, e.agentId ? { state: 'done', activity: '완료' } : { state: 'idle', activity: '대기 중' })
    // 1분 넘게 걸린 메인 턴이 끝나면 맥 알림으로 요약
    if (!e.agentId && !e.isAborted && e.durationMs >= 60000) {
      const files = (await read($, changes)).length
      const failed = await read($, fails)
      const parts = [`완료 · ${Math.round(e.durationMs / 1000)}s`, files && `${files}파일 수정`, failed && `실패 ${failed}`]
      notify($, parts.filter(Boolean).join(' · '))
    }

    return next(e)
  })

  // 권한 대화상자가 뜨면 맥 알림 (AskUserQuestion 은 tool.call 에서 따로 알린다)
  on('classic.PermissionRequest', async ($, e, next) => {
    if (e.tool_name !== 'AskUserQuestion') {
      const input = (e.tool_input ?? {}) as Record<string, unknown>
      const what = [input.command, input.file_path, input.url].find(v => typeof v === 'string') as string | undefined
      notify($, `Claude가 허락을 기다려요: ${e.tool_name}${what ? ` · ${short(what, 40)}` : ''}`)
    }

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    if ('agentId' in ran && ran.agentId) {
      await setDesk($, ran.agentId, { state: 'working', activity: '출근' }, short(e.description || e.subagentType, 18))
    }

    return ran
  })

  on('tool.call', async ($, e, next) => {
    const args = e as unknown as Record<string, unknown>
    const id = e.agentId ?? MAIN
    const isAsking = e.tool === 'AskUserQuestion'
    await setDesk($, id, { state: isAsking ? 'waiting' : 'working', activity: isAsking ? '질문 대기 중' : label(e) })
    await update($, desks, list => list.map(d => (d.id === id ? { ...d, tools: d.tools + 1 } : d)))

    if (isAsking) {
      const q = (Array.isArray(args.questions) ? args.questions[0] : undefined) as { header?: string; question?: string } | undefined
      notify($, `Claude가 답을 기다려요: ${q?.header || short(q?.question ?? '', 40)}`)
    }
    const command = e.tool === 'Bash' && typeof args.command === 'string' ? args.command : undefined
    // Bash·Monitor 의 gh run watch|view / gh pr checks 를 보면 CI 추적을 (다시) 건다
    if ((e.tool === 'Bash' || e.tool === 'Monitor') && typeof args.command === 'string' && CI_COMMAND.test(args.command)) {
      void trackCi($, args.command).catch(() => undefined)
    }

    const startedAt = await $.clock.now()
    const target = [args.file_path, args.pattern].find(v => typeof v === 'string') as string | undefined
    const look: Reading | undefined = LOOK.test(e.tool) && target ? { id: e.tool_use_id, agentId: id, file: target.split('/').pop() || target, tool: e.tool } : undefined
    if (look) await update($, reading, l => [...l, look])
    const ran = await next(e).finally(() => look && update($, reading, l => l.filter(r => r.id !== look.id)))
    const result = 'result' in ran ? (ran.result as Record<string, any> | undefined) : undefined
    const ok = !('deny' in ran && ran.deny) && !ran.isError
    const line: LogLine = { ok, text: label(e), secs: Math.round(((await $.clock.now()) - startedAt) / 1000) }
    await update($, logs, all => ({ ...all, [id]: [...(all[id] ?? []), line].slice(-5) }))
    if (!ok) await update($, fails, n => n + 1)

    // 같은 에이전트가 같은 Bash 명령을 3번 이상 연속 실패하면 띠에 경고, 3번째에만 토스트
    if (command) {
      let n = 0
      await update($, streaks, all => {
        const prev = all[id]
        n = ok ? 0 : prev?.command === command ? prev.n + 1 : 1
        return { ...all, [id]: { command, n } }
      })
      if (n >= 3) await update($, warn, () => command)
      if (n === 3) $.ui.toast(`⚠ ${short(command, 40)} 3번 연속 실패`)
      if (ok && (await read($, warn)) === command) await update($, warn, () => null)
    }
    if (command || e.tool === 'Edit' || e.tool === 'Write') void refreshGit($)

    if (ok && (e.tool === 'Edit' || e.tool === 'Write') && typeof args.file_path === 'string') {
      // ponytail: Edit 은 바꾼 문자열의 줄 수로 어림한다. 정확한 diff 가 필요하면 결과의 structuredPatch 를 읽는다.
      const add = lines(e.tool === 'Write' ? args.content : args.new_string)
      const del = e.tool === 'Write' ? 0 : lines(args.old_string)
      const file = args.file_path.split('/').pop() ?? args.file_path
      await update($, changes, list => {
        const found = list.find((c: Change) => c.file === file)
        return found
          ? list.map((c: Change) => (c.file === file ? { ...c, add: c.add + add, del: c.del + del } : c))
          : [...list, { file, add, del }]
      })
      const name = `${folder}/${file}`
      logDay($, d => ({
        ...d,
        files: d.files.some(f => f.file === name)
          ? d.files.map(f => (f.file === name ? { ...f, add: f.add + add, del: f.del + del } : f))
          : [...d.files, { file: name, add, del }],
      }))
    }
    // /replay 용: 메인 루프의 성공한 수정만, 실제 패치가 있을 때
    if (ok && !e.agentId && (e.tool === 'Edit' || e.tool === 'Write') && typeof args.file_path === 'string') {
      const patch = toPatch(result, args.content)
      if (patch) await update($, edits, l => [...l, { file: args.file_path as string, patch }])
    }
    if (isAsking) await setDesk($, id, { state: 'working', activity: '답 받음' })

    if (e.tool === 'TodoWrite') {
      await update($, tasks, () =>
        e.todos.map((t, i) => ({ id: String(i), subject: t.content, status: t.status, activeForm: t.activeForm })),
      )
      if (ok) addTasks($, e.todos.filter(t => t.status === 'completed').map(t => t.content))
    }
    if (e.tool === 'TaskCreate' && result?.task?.id) {
      const task: Task = { id: result.task.id, subject: e.subject, status: 'pending', activeForm: e.activeForm }
      // 전부 끝난 목록에 새 할 일이 오면 새 작업으로 보고 비운다
      await update($, tasks, list => [...(list.every(t => t.status === 'completed') ? [] : list), task])
    }
    if (e.tool === 'TaskUpdate' && result?.success) {
      const { status, taskId } = e
      const subject = e.subject ?? (await read($, tasks)).find(t => t.id === taskId)?.subject
      if (status === 'completed' && subject) addTasks($, [subject])
      await update($, tasks, list =>
        status === 'deleted'
          ? list.filter(t => t.id !== taskId)
          : list.map(t =>
              t.id === taskId
                ? { ...t, status: status ?? t.status, subject: e.subject ?? t.subject, activeForm: e.activeForm ?? t.activeForm }
                : t,
            ),
      )
    }

    return ran
  })

  // 우측 도킹 패널 맨 위에 작은 사무실 그림만 둔다
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, tasks)
    const people = await read($, desks)
    const tick = await read($, frame)
    const rows = await read($, agents)
    const history = await read($, logs)
    const changed = await read($, changes)
    const pick = await read($, picked)
    const jobs = await read($, bg)
    const looking = await read($, reading)
    const failing = await read($, warn)
    const memos = await read($, memo)
    const viewing = e.props.view.agentId
    const cols = Math.max(12, e.props.bodyColumns)
    // 섹션 제목: 굵은 이름 + 흐린 개수, 위에 한 줄 띄움
    const section = (title: string, count?: string) => (
      <Box marginTop={1}>
        <Text bold>
          {title}
          {count && <Text dimColor> {count}</Text>}
        </Text>
      </Box>
    )
    const logLine = (l: LogLine, indent: number) => (
      <Text dimColor={l.ok}>
        <Text color={l.ok ? 'green' : 'red'}>{l.ok ? '✓' : '✗'}</Text> {short(l.text, cols - indent - 6)} {l.secs}s
      </Text>
    )
    // 누른 줄 아래에 그 에이전트의 상세를 펼친다
    const row = (r: AgentRow, mark: string, color: string | undefined, isLive: boolean) => (
      <Box flexDirection="column">
        <Button key={`agent-${r.id}`} plain onPress={() => update($, picked, p => (p === r.id ? null : r.id))}>
          {pick === r.id ? '▾' : '▸'} <Text color={color}>{mark}</Text> {short(r.description, cols - 6)}
        </Button>
        {pick === r.id && (
          <Box flexDirection="column" paddingLeft={2}>
            <Text dimColor>{r.type} · {r.status}</Text>
            {(history[r.id] ?? []).map(l => logLine(l, 2))}
            {!history[r.id]?.length && <Text dimColor>{isLive ? '아직 도구 호출이 없어요.' : '기록이 없어요.'}</Text>}
            <Button key={`view-${r.id}`} onPress={() => $.ui.view({ agentId: r.id })}>대화 보기 →</Button>
          </Box>
        )}
      </Box>
    )
    const live = rows.filter(r => LIVE.has(r.status))
    const ended = rows.filter(r => !LIVE.has(r.status)).slice(-5)
    const mainLog = history[MAIN] ?? []

    const done = list.filter(t => t.status === 'completed').length
    const current = list.find(t => t.status === 'in_progress')
    const barWidth = Math.max(5, Math.min(10, cols - 10))
    const fit = Math.max(1, Math.floor((cols - 2) / 9))
    const isRunning = people.some(d => d.state === 'working')

    const RECENT = 5
    const add = changed.reduce((n, c) => n + c.add, 0)
    const del = changed.reduce((n, c) => n + c.del, 0)
    const isQuiet = !mainLog.length && !looking.length && !changed.length && !jobs.length && !rows.length
    return (
      <Box flexDirection="column">
        {list.length > 0 && (
          <Box flexDirection="column" borderStyle="round" borderColor="gray" width={Math.min(cols, fit * 9 + 2)}>
            <Text>
              {gauge(Text, (done / list.length) * 100, barWidth, isRunning ? tick : -1)} {done}/{list.length}
              {current ? ` ${short(current.activeForm || current.subject, Math.max(0, fit * 9 - barWidth - 6))}` : ''}
            </Text>
          </Box>
        )}
        {failing && <Text color="yellow">⚠ {short(failing, cols - 14)} 3번 연속 실패</Text>}
        {viewing && <Button key="back" onPress={() => $.ui.view({})}>← 메인 대화로</Button>}
        {memos.length > 0 && section('📅 할 일 메모', `${memos.length}개`)}
        {memos.map((m, i) => {
          const { title, date } = memoHead(memos, i)
          return (
            <Box flexDirection="column">
              {title && section(short(title, cols - 2))}
              {date && <Box marginTop={title ? 0 : 1}><Text color="cyan">{date}</Text></Box>}
              <Text>☐ {i + 1}. {short(m.text, cols - 8)}</Text>
              {m.note && <Text dimColor>   {short(m.note, cols - 5)}</Text>}
            </Box>
          )
        })}
        {isQuiet && <Text dimColor>조용해요. 일을 시작하면 여기에 진행 상황이 보여요.</Text>}

        {rows.length > 0 && section('에이전트', `실행 ${live.length} · 끝남 ${ended.length}`)}
        {live.map(r => row(r, '●', 'yellow', true))}
        {ended.map(r => row(r, r.status === 'completed' ? '✓' : '✗', r.status === 'completed' ? 'green' : 'red', false))}

        {looking.length > 0 && section('지금 보는 파일')}
        {looking.map(r => (
          <Text>
            {r.tool === 'Edit' || r.tool === 'Write' ? '✏' : '📖'} {short(r.file, cols - 12)} <Text dimColor>({r.tool})</Text>
          </Text>
        ))}

        {mainLog.length > 0 && section('Claude 최근 도구')}
        {mainLog.map(l => logLine(l, 0))}

        {changed.length > 0 && section('바뀐 파일', `${changed.length}개 · +${add} −${del}`)}
        {changed.slice(-RECENT).map(c => (
          <Text>
            {short(c.file, cols - 14)} <Text color="green">+{c.add}</Text> <Text color="red">−{c.del}</Text>
          </Text>
        ))}
        {changed.length > RECENT && <Text dimColor>… 외 {changed.length - RECENT}개 · /replay 로 다시 보기</Text>}

        {jobs.length > 0 && section('백그라운드', `${jobs.length}개`)}
        {jobs.map(t => <Text>◌ {short(t.description, cols - 12)} <Text dimColor>({t.type})</Text></Text>)}
      </Box>
    )
  })

  on('command.run', { command: 'replay' }, async ($) => {
    if (!(await replayList($)).length) return { text: '직전 턴에 파일 수정이 없어요.' }
    await update($, replayAt, () => 0)
    await $.ui.open({ id: REPLAY, title: 'Replay' })

    return { text: 'Replay 패널을 열었어요. h/l 로 앞뒤, 파일 이름을 눌러 바로 이동해요.' }
  })

  on('ui.render', { component: 'Pane', requestId: REPLAY }, async ($, e) => {
    const { Box, Button, Code, Text } = $.ui.resolve(e)
    const list = await replayList($)
    const i = Math.min(await read($, replayAt), Math.max(0, list.length - 1))
    const r = list[i]
    if (!r) return <Text dimColor>직전 턴에 파일 수정이 없어요.</Text>

    const cols = Math.max(20, e.props.bodyColumns)
    const home = cwd.match(/^\/Users\/[^/]+/)?.[0]
    const where = (file: string) => (cwd && file.startsWith(cwd + '/') ? file.slice(cwd.length + 1) : home ? file.replace(home, '~') : file)
    // 패치의 +/− 줄 수
    const count = (patch: string) => {
      const ls = patch.split('\n')
      return { add: ls.filter(l => l.startsWith('+')).length, del: ls.filter(l => l.startsWith('-')).length }
    }
    const now = count(r.patch)
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>{r.file.split('/').pop()}</Text> <Text color="green">+{now.add}</Text> <Text color="red">−{now.del}</Text>
          <Text dimColor>  {i + 1}/{list.length}</Text>
        </Text>
        <Text dimColor>{short(where(r.file), cols)}</Text>
        <Code source={r.patch} format="diff" path={r.file} />
        <Box>
          <Button key="prev" hotkey="h" dimColor={i === 0} onPress={() => update($, replayAt, k => Math.max(0, k - 1))}>◀ 이전 (h)</Button>
          <Button key="next" hotkey="l" dimColor={i === list.length - 1} onPress={() => update($, replayAt, k => Math.min(list.length - 1, k + 1))}>다음 (l) ▶</Button>
          <Button key="close" onPress={() => $.ui.close({ id: REPLAY })}>닫기</Button>
        </Box>
        {list.length > 1 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>이번 턴에 고친 파일</Text>
            {list.map((x, k) => (
              <Button key={`file-${k}`} plain onPress={() => update($, replayAt, () => k)}>
                {k === i ? '▸' : ' '} {short(where(x.file), cols - 4)}
              </Button>
            ))}
          </Box>
        )}
      </Box>
    )
  })

  // 입력창 바로 위: 세션 정보, CI, 아침 요약 (반복 실패 경고는 오피스 패널로 옮겼다)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const watch = await read($, ci)
    const failing = await read($, warn)
    const morning = await read($, recap)
    const s = await read($, sess)
    if (e.props.hasSurvey || (!watch && !failing && !morning && !s)) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const parts = s ? sessParts(s, await $.clock.now()) : []
    // CI 결과가 나왔으면 성공은 초록, 실패는 빨강으로
    const ciColor = watch?.isDone ? (watch.line.includes('✓ 성공') ? 'green' : 'red') : undefined
    // 같은 자리에 그리는 다른 mod(세션 계기판)를 가리지 않고 아래에 함께 둔다
    const below = await next(e)

    return (
      <Box flexDirection="column">
        {parts.length > 0 && (
          <Text>
            {parts.map((p, k) => (
              <Text>
                {k > 0 && <Text dimColor> · </Text>}
                {p.color ? <Text color={p.color}>{p.text}</Text> : <Text dimColor>{p.text}</Text>}
              </Text>
            ))}
          </Text>
        )}
        {watch && (ciColor ? <Text color={ciColor}>{watch.line}</Text> : <Text dimColor>{watch.line}</Text>)}
        {failing && <Text color="yellow">⚠ {short(failing, 40)} 3번 연속 실패</Text>}
        {morning && <Text dimColor>{morning}</Text>}
        {below}
      </Box>
    )
  })

  // 일하는 동안 뜨는 스피너 줄을 진행 게이지로 바꾼다. 진행률을 모르면 왕복하는 빛만 보인다
  on('ui.render', { component: 'Spinner' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const tick = await read($, frame)
    const list = await read($, tasks)
    const done = list.filter(t => t.status === 'completed').length
    const secs = Math.max(0, Math.round(((await $.clock.now()) - (await read($, turnStart))) / 1000))
    // CI 를 지켜보는 중이면 게이지는 CI 진행률, 꼬리는 지금 단계
    const watch = await read($, ci)
    const isCi = !!watch && !watch.isDone
    const pct = isCi ? watch.pct : list.length ? (done / list.length) * 100 : undefined
    const tail = isCi ? `CI${watch.now ? ` ${watch.now}` : ''} · ` : list.length ? `${done}/${list.length} · ` : ''

    return (
      <Box>
        <Text>{glowBar(Text, tick, pct)} </Text>
        <Text color="#5f8f8c">{e.props.message ?? e.props.word}{e.props.suffix}</Text>
        <Text dimColor> {tail}{elapsed(secs)}</Text>
      </Box>
    )
  })
}
