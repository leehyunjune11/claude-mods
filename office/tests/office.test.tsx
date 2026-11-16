import { expect, mock, test } from 'claude-code/testing'
declare const setTimeout: (fn: (v?: unknown) => void, ms: number) => unknown


const PANE = {
  plugin: 'office',
  component: 'Pane',
  requestId: 'office',
  surface: 'terminal',
  props: { title: 'Agent Office', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('미니 오피스에 게이지와 일하는 얼굴이 뜬다', async ($, on) => {
  on('clock.now', () => ({ value: 0 }) as never)
  let n = 0
  on('tool.call', (_, e) =>
    e.tool === 'TaskCreate' ? { result: { task: { id: String(++n), subject: e.subject } } } : { result: { success: true } },
  )

  await $.tool.call({ tool: 'TaskCreate', subject: '설계', description: 'd' })
  await $.tool.call({ tool: 'TaskCreate', subject: '구현', description: 'd' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress', activeForm: '구현하는 중' })

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /1\/2/ }))?.text).toContain('구현하는 중')
  expect(await ui.find({ type: 'Text', text: /\(•_•\)/ })).toBeUndefined()
  await ui.unmount()
})

test('작업 기록과 바뀐 파일이 뜬다', async ($, on) => {
  on('clock.now', () => ({ value: 0 }) as never)
  on('tool.call', (_, e) => (e.tool === 'Bash' ? { result: {}, isError: true } : { result: {} }) as never)

  await $.tool.call({ tool: 'Edit', file_path: '/a/b/auth.ts', old_string: 'x', new_string: 'y\nz\nw' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /auth\.ts \+3/ }))?.text).toContain('−1')
  expect((await ui.find({ type: 'Text', text: /✗ Bash/ }))?.text).toBe('✗ Bash: npm test 0s')
  expect((await ui.find({ type: 'Text', text: /Edit: auth\.ts/ }))?.text).toBeDefined()
  await ui.unmount()
})

test('에이전트 줄을 누르면 상세가 펼쳐진다', async ($, on) => {
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'office' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('agent.list', () => ({ value: [{ id: 'a1', type: 'Explore', description: '코드 탐색', status: 'running' }] }) as never)
  on('tool.call', () => ({ result: {} }) as never)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(3000)
  await $.tool.call({ tool: 'Grep', pattern: 'auth', agentId: 'a1' } as never)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /Explore · running/ })).toBeUndefined()
  await ui.press({ key: 'agent-a1' })
  expect((await ui.find({ type: 'Text', text: /Explore · running/ }))?.text).toBe('Explore · running')
  expect((await ui.find({ type: 'Text', text: /Grep: auth/ }))?.text).toContain('✓')
  await ui.unmount()
})

const BAND = {
  plugin: 'office',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as never
// 띠에 띄울 게 없을 때 next(e) 가 닿는 엔진 기본 그림
const engineBand = (on: any) => on('ui.render', ($: any, e: any) => {
  const { Text } = $.ui.resolve(e)
  return <Text>엔진</Text>
})
const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const
// session.start 에 필요한 것들과 git·gh 답을 한 번에 건다
const boot = (on: any, git: Record<string, string>) => {
  on('command.register', () => ({ value: { command: 'office' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    const out = git[e.argv.join(' ')]
    return { value: out === undefined ? { exitCode: 128, stdout: '', stderr: 'no' } : { exitCode: 0, stdout: out, stderr: '' } } as never
  })
}

test('안전한 브랜치면 띠에 git 칩도 비용도 없다', async ($, on) => {
  const clock = mock.clock(on)
  boot(on, { 'git status --porcelain=v1 -b': '## feat/x...origin/feat/x\n M a.ts\n?? b.ts\n' })
  engineBand(on)

  await $.session.start(START)
  await clock.advance(10000)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /비용/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /⎇/ })).toBeUndefined()
  await ui.unmount()
})

test('main 에서 worktree 없이 고쳐도 경고는 없다', async ($, on) => {
  const clock = mock.clock(on)
  boot(on, {
    'git status --porcelain=v1 -b': '## main\n M a.ts\n',
    'git rev-parse --path-format=absolute --git-dir --git-common-dir': '/r/.git\n/r/.git\n',
  })
  engineBand(on)
  await $.session.start(START)
  await clock.advance(10000)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /⎇/ })).toBeUndefined()
  await ui.unmount()
})

test('git 저장소가 아니면 띠에 아무것도 없다', async ($, on) => {
  const clock = mock.clock(on)
  boot(on, {})
  engineBand(on)
  await $.session.start(START)
  await clock.advance(10000)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /⎇/ })).toBeUndefined()
  await ui.unmount()
})

test('같은 Bash 명령이 3번 연속 실패하면 경고하고 성공하면 지운다', async ($, on) => {
  on('clock.now', () => ({ value: 0 }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  const toasts: string[] = []
  on('ui.toast', (_, e: any) => (toasts.push(e.text), { value: undefined }) as never)
  let isFailing = true
  engineBand(on)
  on('tool.call', () => ({ result: {}, isError: isFailing }) as never)

  for (let i = 0; i < 4; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /연속 실패/ }))?.text).toBe('⚠ npm test 3번 연속 실패')
  expect(toasts).toEqual(['⚠ npm test 3번 연속 실패'])
  // 새 프롬프트가 경고를 지워도 4번째 실패면 다시 뜬다
  await $.prompt.submit({ text: 'x' } as never).catch(() => undefined)
  expect(await ui.find({ type: 'Text', text: /연속 실패/ })).toBeUndefined()
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  expect((await ui.find({ type: 'Text', text: /연속 실패/ }))?.text).toBe('⚠ npm test 3번 연속 실패')
  expect(toasts.length).toBe(1)
  isFailing = false
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  expect(await ui.find({ type: 'Text', text: /연속 실패/ })).toBeUndefined()
  await ui.unmount()
})

test('질문·권한 대기와 1분 넘은 턴 끝에 맥 알림', async ($, on) => {
  on('clock.now', () => ({ value: 0 }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  const sent: string[] = []
  on('ui.notify', (_, e) => (sent.push(e.text), { value: { isSent: true, channel: 'terminal_bell' } }) as never)
  on('tool.call', (_, e) => ({ result: {}, isError: e.tool === 'Bash' }) as never)
  on('classic.PermissionRequest', () => ({}) as never)
  on('turn.start', () => ({ turnId: 't' }) as never)
  on('turn.complete', () => ({ text: '' }) as never)

  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ header: '배포 대상', question: '어디로 배포할까요?' }] } as never)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } } as never)
  await $.turn.start({ text: 'x', turnId: 't' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/a/x.ts', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  await $.turn.complete({ answer: '', durationMs: 42000, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await $.turn.complete({ answer: '', durationMs: 75000, isAborted: false, turnId: 't', reason: 'answer' } as never)

  expect(sent).toEqual([
    'Claude가 답을 기다려요: 배포 대상',
    'Claude가 허락을 기다려요: Bash · rm -rf build',
    '완료 · 75s · 1파일 수정 · 실패 1',
  ])
})

test('/office today 가 오늘 고친 파일과 끝낸 일을 보여준다', async ($, on) => {
  mock.clock(on, { now: 40.5 * 86400000 })
  boot(on, {})
  // mock.store 대신 직접 답해 지운 키를 본다
  const store = new Map<string, unknown>([['1970-01-01', { files: [], tasks: ['옛날 일'] }]])
  on('store.get', (_, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_, e) => (store.set(e.key, e.value), { value: undefined }) as never)
  on('store.keys', () => ({ value: [...store.keys()] }) as never)
  on('store.delete', (_, e) => (store.delete(e.key), { value: undefined }) as never)
  on('tool.call', () => ({ result: {} }) as never)
  await $.session.start({ ...START, cwd: '/w/office' })

  await $.tool.call({ tool: 'Edit', file_path: '/w/office/a.ts', old_string: 'a', new_string: 'b\nc' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/office/a.ts', old_string: 'a', new_string: 'b' } as never)
  const todos = [{ content: '설계', status: 'completed', activeForm: '설계 중' }]
  await $.tool.call({ tool: 'TodoWrite', todos } as never)
  await $.tool.call({ tool: 'TodoWrite', todos } as never)

  const { text } = await $.command.run({
    command: 'office',
    args: 'today',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  } as never)
  expect(text).toContain('바뀐 파일 1개 · +3 −2')
  expect(text).toContain('office/a.ts +3 −2')
  expect(text).toContain('끝낸 일 1개')
  expect(text).toContain('✓ 설계')
  expect([...store.keys()]).toEqual(['1970-02-10'])
})

test('백그라운드 gh run view 뒤에도 CI 를 계속 보고, 끝나면 알리고 60초 뒤 지운다', async ($, on) => {
  const clock = mock.clock(on)
  const steps = [
    { name: 'a', status: 'completed' },
    { name: 'b', status: 'completed' },
    { name: 'Run playwright', status: 'in_progress' },
    ...[4, 5, 6, 7].map(n => ({ name: `s${n}`, status: 'queued' })),
  ]
  const run = {
    workflowName: 'CI',
    status: 'in_progress',
    conclusion: '',
    jobs: [
      { name: 'lint', status: 'completed', conclusion: 'success', steps: [] },
      { name: 'unit', status: 'completed', conclusion: 'success', steps: [] },
      { name: 'e2e', status: 'in_progress', conclusion: '', steps },
    ],
  }
  on('process.run', (_, e) =>
    ({ value: e.argv.join(' ') === 'gh run view 42 --json workflowName,status,conclusion,jobs' ? { exitCode: 0, stdout: JSON.stringify(run), stderr: '' } : { exitCode: 1, stdout: '', stderr: '' } }) as never,
  )
  const sent: string[] = []
  on('ui.notify', (_, e) => (sent.push(e.text), { value: { isSent: true, channel: 'terminal_bell' } }) as never)
  on('tool.call', () => ({ result: {} }) as never)
  engineBand(on)

  // 백그라운드로 띄운 호출은 바로 돌아온다
  await $.tool.call({ tool: 'Bash', command: 'gh run view 42', run_in_background: true } as never)
  await clock.settle()
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /CI ·/ }))?.text).toBe('CI · CI · e2e ▶ Run playwright (3/7) · ✓2 ✗0 ⏳1')

  const spin = await $.ui.mount({
    plugin: 'office',
    component: 'Spinner',
    surface: 'terminal',
    props: { word: '기다리는 중', message: null, suffix: '…', mode: 'tool-use' },
  } as never)
  expect((await spin.find({ type: 'Text', text: /^ CI/ }))?.text).toBe(' CI e2e ▶ Run playwright (3/7) · 0s')
    await spin.unmount()

  run.status = 'completed'
  run.conclusion = 'failure'
  run.jobs[2] = { name: 'e2e', status: 'completed', conclusion: 'failure', steps }
  await clock.advance(10000)
  expect(sent).toEqual(['CI 실패: CI · e2e'])
  expect((await ui.find({ type: 'Text', text: /CI ·/ }))?.text).toBe('CI · CI · ✗ 실패 (e2e)')
  await clock.advance(60000)
  expect(await ui.find({ type: 'Text', text: /CI ·/ })).toBeUndefined()
  await ui.unmount()
})

test('gh pr checks 556 은 세션 브랜치가 아니라 PR 브랜치의 run 을 본다', async ($, on) => {
  const clock = mock.clock(on)
  const run = { workflowName: 'CI', status: 'in_progress', conclusion: '', jobs: [{ name: 'e2e', status: 'in_progress', conclusion: '', steps: [] }] }
  const out: Record<string, string> = {
    'git status --porcelain=v1 -b': '## dev\n',
    'gh pr view 556 --json headRefName -q .headRefName': 'feat/x\n',
    'gh run list --branch feat/x --limit 1 --json databaseId,status,name': JSON.stringify([{ databaseId: 7, status: 'in_progress', name: 'CI' }]),
    'gh run view 7 --json workflowName,status,conclusion,jobs': JSON.stringify(run),
  }
  on('process.run', (_, e) => {
    const stdout = out[e.argv.join(' ')]
    return { value: stdout === undefined ? { exitCode: 1, stdout: '', stderr: '' } : { exitCode: 0, stdout, stderr: '' } } as never
  })
  on('tool.call', () => ({ result: {} }) as never)
  engineBand(on)

  await $.tool.call({ tool: 'Bash', command: 'cd ~/orca/workspaces/r/feat-x && gh pr checks 556 --watch --interval 30' } as never)
  await clock.settle()
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /CI ·/ }))?.text).toBe('CI · CI · e2e · ✓0 ✗0 ⏳1')
  await ui.unmount()
})

test('아침 첫 세션 띠에 지난 작업일 요약이 뜨고, 프롬프트를 보내면 사라진다', async ($, on) => {
  mock.clock(on, { now: new Date(2026, 9, 27, 10).getTime() })
  boot(on, {})
  engineBand(on)
  const store = new Map<string, unknown>([
    ['2026-10-23', { files: [], tasks: ['오래된 일'] }],
    ['2026-10-24', { files: [{ file: 'office/a.ts', add: 3, del: 1 }], tasks: ['설계', '구현'] }],
  ])
  on('store.get', (_, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_, e) => (store.set(e.key, e.value), { value: undefined }) as never)
  on('store.keys', () => ({ value: [...store.keys()] }) as never)
  on('store.delete', (_, e) => (store.delete(e.key), { value: undefined }) as never)

  await $.session.start(START)
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /☀/ }))?.text).toBe('☀ 지난 작업일(2026-10-24): 파일 1개 · 끝낸 일 2개 — /office yesterday')

  const { text } = await $.command.run({
    command: 'office',
    args: 'yesterday',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  } as never)
  expect(text).toContain('지난 작업일(2026-10-24) 한 일')
  expect(text).toContain('office/a.ts +3 −1')
  expect(text).toContain('✓ 구현')

  await $.prompt.submit({ text: 'x' } as never).catch(() => undefined)
  expect(await ui.find({ type: 'Text', text: /☀/ })).toBeUndefined()
  expect(store.get('recapShown')).toBe('2026-10-27')
  await ui.unmount()

  // 같은 날 다시 시작하면 띄우지 않는다
  await $.session.start(START)
  const again = await $.ui.mount(BAND)
  expect(await again.find({ type: 'Text', text: /☀/ })).toBeUndefined()
  await again.unmount()
})

test('스피너 줄이 파란 게이지와 말로 바뀐다', async ($, on) => {
  on('clock.now', () => ({ value: 0 }) as never)
  const ui = await $.ui.mount({
    plugin: 'office',
    component: 'Spinner',
    surface: 'terminal',
    props: { word: '맡기는 중', message: null, suffix: '…', mode: 'tool-use' },
  } as never)
  expect((await ui.find({ type: 'Text', text: /맡기는 중/ }))?.text).toBe('맡기는 중…')
  expect((await ui.find({ type: 'Text', text: /━/ }))?.text).toContain('━')
  await ui.unmount()
})

test('session.start 가 남은 CI 줄을 비우고 타이머를 두 번 걸지 않는다', async ($, on) => {
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'office' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  engineBand(on)
  let lists = 0
  on('agent.list', () => (lists++, { value: [] }) as never)
  on('tool.call', async () => (await clock.sleep(10000), { result: {} }) as never)
  on('process.run', (_, e) =>
    ({ value: e.argv[1] === 'run' && e.argv[2] === 'view' ? { exitCode: 0, stdout: '{"workflowName":"CI","status":"in_progress","jobs":[]}', stderr: '' } : { exitCode: 128, stdout: '', stderr: '' } }) as never,
  )

  void $.tool.call({ tool: 'Bash', command: 'gh run watch 7' } as never)
  await clock.settle()
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /CI ·/ }))?.text).toBe('CI · CI · ✓0 ✗0 ⏳0')
  await $.session.start(START)
  expect(await ui.find({ type: 'Text', text: /CI ·/ })).toBeUndefined()
  await ui.unmount()

  await $.session.start(START)
  lists = 0
  await clock.advance(3000)
  expect(lists).toBe(1)
})

test('끝난 run 을 들여다봐도 도는 run 추적은 그대로다', async ($, on) => {
  const clock = mock.clock(on)
  const run42 = { workflowName: 'Deploy', status: 'in_progress', conclusion: '', jobs: [{ name: 'build', status: 'in_progress', conclusion: '', steps: [] }] }
  const run41 = { workflowName: 'Old', status: 'completed', conclusion: 'failure', jobs: [] }
  on('process.run', (_, e) => {
    const id = e.argv[0] === 'gh' && e.argv[2] === 'view' ? e.argv[3] : undefined
    const data = id === '42' ? run42 : id === '41' ? run41 : undefined
    return { value: data ? { exitCode: 0, stdout: JSON.stringify(data), stderr: '' } : { exitCode: 1, stdout: '', stderr: '' } } as never
  })
  const sent: string[] = []
  on('ui.notify', (_, e) => (sent.push(e.text), { value: { isSent: true, channel: 'terminal_bell' } }) as never)
  on('tool.call', () => ({ result: {} }) as never)
  engineBand(on)

  await $.tool.call({ tool: 'Monitor', command: 'gh run watch 42', description: 'ci', timeout_ms: 1000 } as never)
  await clock.settle()
  // 플래그가 id 앞에 와도 41 로 읽고, 끝난 run 이라 갈아타지 않는다
  await $.tool.call({ tool: 'Bash', command: 'gh run view --log-failed 41' } as never)
  await clock.settle()
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /CI ·/ }))?.text).toBe('CI · Deploy · build · ✓0 ✗0 ⏳1')

  run42.jobs[0] = { name: 'build', status: 'completed', conclusion: 'success', steps: [] }
  Object.assign(run42, { status: 'completed', conclusion: 'success' })
  await clock.advance(10000)
  expect(sent).toEqual(['CI 끝: Deploy 성공'])
  expect((await ui.find({ type: 'Text', text: /CI ·/ }))?.text).toBe('CI · Deploy · ✓ 성공')
  await ui.unmount()
})

test('Stop 이 알린 백그라운드 셸 작업이 패널에 뜨고, 서브에이전트는 빠진다', async ($, on) => {
  on('clock.now', () => ({ value: 0 }) as never)
  on('classic.Stop', () => ({}) as never)
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [
      { id: 'b1', type: 'shell', status: 'running', description: 'd', command: 'npm run build' },
      { id: 'a1', type: 'subagent', status: 'running', description: '코드 조사' },
    ],
  } as never)

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /백그라운드 1개/ }))?.text).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /npm run build/ }))?.text).toContain('(shell)')
  expect(await ui.find({ type: 'Text', text: /코드 조사/ })).toBeUndefined()
  await ui.unmount()

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as never)
  const after = await $.ui.mount(PANE)
  expect(await after.find({ type: 'Text', text: /^백그라운드/ })).toBeUndefined()
  await after.unmount()
})

// ---- 지금 보는 파일 · /replay · 세션 정보 띠 ----
test('지금 보는 파일: 진행 중인 Read 가 패널에 뜨고, 같은 파일 두 번 중 하나가 끝나도 하나는 남는다', async ($, on) => {
  on('clock.now', () => ({ value: 0 }) as never)
  const gates: (() => void)[] = []
  on('tool.call', () => new Promise(res => gates.push(() => res({ result: {} } as never))) as never)
  const a = $.tool.call({ tool: 'Read', file_path: '/a/auth.ts' } as never)
  const b = $.tool.call({ tool: 'Read', file_path: '/a/auth.ts' } as never)
  const c = $.tool.call({ tool: 'Edit', file_path: '/a/db.ts', old_string: 'x', new_string: 'y' } as never)
  while (gates.length < 3) await new Promise(r => setTimeout(r, 5))
  const ui = await $.ui.mount(PANE)
  expect((await ui.findAll({ type: 'Text', text: /auth\.ts \(Read\)/ })).length).toBe(2)
  expect((await ui.find({ type: 'Text', text: /db\.ts \(Edit\)/ }))?.text).toBe('✏ db.ts (Edit)')
  gates[0]!()
  await a
  expect((await ui.findAll({ type: 'Text', text: /auth\.ts \(Read\)/ })).length).toBe(1)
  gates[1]!()
  gates[2]!()
  await b
  await c
  expect(await ui.find({ type: 'Text', text: /지금 보는 파일/ })).toBeUndefined()
  await ui.unmount()
})

const REPLAY_PANE = {
  plugin: 'office',
  component: 'Pane',
  requestId: 'office-replay',
  surface: 'terminal',
  props: { title: 'Replay', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const replay = ($: any) =>
  $.command.run({ command: 'replay', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)
// 엔진이 Edit 결과에 주는 structuredPatch (jsdiff: 줄마다 ' ' '+' '-' 가 붙어 있다)
const patched = (oldStart: number, lines: string[]) => ({
  result: {
    structuredPatch: [
      {
        oldStart,
        oldLines: lines.filter(l => !l.startsWith('+')).length,
        newStart: oldStart,
        newLines: lines.filter(l => !l.startsWith('-')).length,
        lines,
      },
    ],
  },
})
// Code format="diff" 가 읽는 unified diff 인지: 헤더의 줄 수가 본문과 맞는다
const isUnifiedDiff = (source: string) => {
  const rows = source.split('\n')
  let i = 0
  while (i < rows.length) {
    const m = rows[i]!.match(/^@@ -\d+,(\d+) \+\d+,(\d+) @@$/)
    if (!m) return false
    let [o, n] = [Number(m[1]), Number(m[2])]
    i++
    while (i < rows.length && (o > 0 || n > 0)) {
      const c = rows[i]![0]
      if (c === ' ') o--, n--
      else if (c === '-') o--
      else if (c === '+') n--
      else return false
      i++
    }
    if (o || n) return false
  }
  return rows.length > 0 && !/\r/.test(source)
}
const replayBoot = (on: any, answers: Record<string, unknown>) => {
  on('clock.now', () => ({ value: 0 }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  const opened: string[] = []
  on('ui.open', (_: unknown, e: any) => (opened.push(e.id), { value: { isPlaced: true } }) as never)
  on('ui.close', () => ({ value: undefined }) as never)
  on('tool.call', (_: unknown, e: any) => (answers[`${e.tool} ${e.file_path}`] ?? { result: {} }) as never)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  return opened
}
const turn = ($: any, text: string) => $.turn.start({ text, turnId: 't' } as never)
const edit = ($: any, file: string) => $.tool.call({ tool: 'Edit', file_path: file, old_string: 'a', new_string: 'b' } as never)

test('/replay: 턴이 끝난 직후 방금 수정을 실제 줄 번호 diff 로 하나씩 넘겨 본다', async ($, on) => {
  const opened = replayBoot(on, {
    'Edit /a/x.ts': patched(12, [' keep', '-old', '+new']),
    'Edit /a/y.ts': patched(40, ['-a', '+b', '+c']),
  })
  await turn($, '고쳐줘')
  await edit($, '/a/x.ts')
  await edit($, '/a/y.ts')
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer' } as never)

  expect((await replay($)).text).toContain('Replay 패널을 열었어요.')
  expect(opened).toContain('office-replay')
  const ui = await $.ui.mount(REPLAY_PANE)
  expect((await ui.find({ type: 'Text', text: /\/2/ }))?.text).toBe('x.ts +1 −1  1/2')
  const code = await ui.find({ type: 'Code' })
  expect(code?.props.format).toBe('diff')
  expect(code?.props.source).toBe('@@ -12,2 +12,2 @@\n keep\n-old\n+new')
  expect(isUnifiedDiff(code?.props.source as string)).toBe(true)
  await ui.press({ key: 'next' })
  expect((await ui.find({ type: 'Text', text: /\/2/ }))?.text).toBe('y.ts +2 −1  2/2')
  expect((await ui.find({ type: 'Code' }))?.props.source).toBe('@@ -40,1 +40,2 @@\n-a\n+b\n+c')
  await ui.press({ key: 'next' })
  expect((await ui.find({ type: 'Text', text: /\/2/ }))?.text).toBe('y.ts +2 −1  2/2')
  await ui.press({ key: 'prev' })
  expect((await ui.find({ type: 'Text', text: /\/2/ }))?.text).toBe('x.ts +1 −1  1/2')
  await ui.unmount()
})

test('/replay: 백그라운드 알림 턴은 구간을 나누지 않고, 새 프롬프트에 수정이 없으면 직전 구간', async ($, on) => {
  replayBoot(on, { 'Edit /a/auth.ts': patched(1, ['-a', '+b']) })
  await turn($, '로그인 고쳐줘')
  await edit($, '/a/auth.ts')
  await edit($, '/a/auth.ts')
  await turn($, '')
  await turn($, '')
  const ui = await $.ui.mount(REPLAY_PANE)
  expect((await ui.find({ type: 'Text', text: /\/2/ }))?.text).toBe('auth.ts +1 −1  1/2')
  await turn($, '고마워')
  expect((await ui.find({ type: 'Text', text: /\/2/ }))?.text).toBe('auth.ts +1 −1  1/2')
  await ui.unmount()
  await turn($, '다음 거')
  expect((await replay($)).text).toBe('직전 턴에 파일 수정이 없어요.')
})

test('/replay: 실패·패치 없는 수정과 서브에이전트 수정은 빼고, 새 파일 Write 는 전부 +, CRLF 는 \\r 를 뺀다', async ($, on) => {
  replayBoot(on, {
    'Edit /a/bad.ts': { result: {}, isError: true },
    'Edit /a/none.ts': { result: {} },
    'Write /a/new.ts': { result: { type: 'create', structuredPatch: [] } },
    'Edit C:/w/a.bat': patched(3, ['-echo a\r', '+echo c\r']),
    'Edit /a/sub.ts': patched(1, ['-a', '+b']),
  })
  await turn($, '해줘')
  await edit($, '/a/bad.ts')
  await edit($, '/a/none.ts')
  await $.tool.call({ tool: 'Write', file_path: '/a/new.ts', content: 'one\ntwo\n' } as never)
  await edit($, 'C:/w/a.bat')
  await $.tool.call({ tool: 'Edit', file_path: '/a/sub.ts', old_string: 'a', new_string: 'b', agentId: 'a1' } as never)
  await replay($)
  const ui = await $.ui.mount(REPLAY_PANE)
  expect((await ui.find({ type: 'Text', text: /\/2/ }))?.text).toBe('new.ts +2 −0  1/2')
  expect((await ui.find({ type: 'Code' }))?.props.source).toBe('@@ -0,0 +1,2 @@\n+one\n+two')
  await ui.press({ key: 'next' })
  const crlf = (await ui.find({ type: 'Code' }))?.props.source as string
  expect(crlf).toBe('@@ -3,1 +3,1 @@\n-echo a\n+echo c')
  expect(isUnifiedDiff(crlf)).toBe(true)
  await ui.unmount()
})

test('세션 정보 띠: ctx %, 캐시 남은 시간(1시간), 턴·토큰 누적, 사용량 창', async ($, on) => {
  const clock = mock.clock(on)
  boot(on, {})
  on('ui.status', () => ({ value: undefined }) as never)
  on('session.usage', () => ({
    value: { startedAt: 0, context: { percent: 42, tokens: 84000, window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 23.4 }] },
  }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  engineBand(on)
  const done = (usage: Record<string, number>, agentId?: string) =>
    $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', agentId, usage: { model: 'm', ...usage } } as never)

  await $.session.start(START)
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text' }))?.text).toBe('엔진')
  await done({ input_tokens: 20000, output_tokens: 50000, cache_read_input_tokens: 1100000, cache_creation_input_tokens: 80000 })
  await done({ input_tokens: 999, output_tokens: 999, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, 'a1')
  await done({ input_tokens: 0, output_tokens: 35000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  expect((await ui.find({ type: 'Text', text: /ctx/ }))?.text).toBe('ctx 42% · 캐시 60분 · 5h 23% · 턴 2 · in 1.2M out 85k 캐시적중 92%')
  await clock.advance(3000)
  expect((await ui.find({ type: 'Text', text: /ctx/ }))?.text).toContain('캐시 59분')
  // 150ms 프레임 타이머가 있어 한 번에 1시간을 넘기지 못한다
  for (let i = 0; i < 36; i++) await clock.advance(100000)
  expect((await ui.find({ type: 'Text', text: /ctx/ }))?.text).toContain('캐시 만료')
  expect(await ui.find({ type: 'Text', text: /\$/ })).toBeUndefined()
  await ui.unmount()
})

test('/replay: replace_all 처럼 떨어진 두 곳을 고치면 hunk 두 개를 실제 줄 번호로 (adv-1 hunk-probe)', async ($, on) => {
  const hunk = (at: number) => ({ oldStart: at, oldLines: 1, newStart: at, newLines: 1, lines: ['-foo()', '+bar()'] })
  replayBoot(on, { 'Edit /a/big.ts': { result: { structuredPatch: [hunk(100), hunk(300)] } } })
  await turn($, '이름 바꿔줘')
  await edit($, '/a/big.ts')
  await replay($)
  const ui = await $.ui.mount(REPLAY_PANE)
  const source = (await ui.find({ type: 'Code' }))?.props.source as string
  expect(source).toBe('@@ -100,1 +100,1 @@\n-foo()\n+bar()\n@@ -300,1 +300,1 @@\n-foo()\n+bar()')
  expect(isUnifiedDiff(source)).toBe(true)
  await ui.unmount()
})

test('빈 오피스는 안내 한 줄만 보이고, 에이전트 0개 줄은 없다', async ($, on) => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface } as never)
    expect((await ui.find({ type: 'Text', text: /조용해요/ }))?.text).toContain('조용해요')
    expect(await ui.find({ type: 'Text', text: /에이전트 0개/ })).toBeUndefined()
    await ui.unmount()
  }
})

// 메모 파일과 세션을 준비한다. git 이 비면 저장소가 아닌 폴더
const memoBoot = async ($: any, on: any, seed: unknown[], cwd = '/w/office', git: Record<string, string> = {}) => {
  let file = JSON.stringify(seed)
  mock.clock(on, { now: new Date(2026, 10, 4).getTime() })
  boot(on, git)
  on('fs.read', () => ({ value: file }) as never)
  on('fs.write', (_: unknown, e: { text: string }) => ((file = e.text), { value: undefined }) as never)
  await $.session.start({ ...START, cwd })
  return {
    run: (args: string) => $.command.run({ command: 'office', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never),
    saved: () => JSON.parse(file),
    setFile: (list: unknown[]) => { file = JSON.stringify(list) },
  }
}

test('다른 세션이 메모를 끼워 넣어 번호가 밀리면 done 은 지우지 않고, 다시 확인하면 지운다', async ($, on) => {
  const { run, saved, setFile } = await memoBoot($, on, [{ text: 'a1', project: 'a' }, { text: 'b1', project: 'b' }])
  await run('todo')
  setFile([{ text: 'a1', project: 'a' }, { text: 'b1', project: 'b' }, { text: 'a2', project: 'a' }])

  expect((await run('done 2')).text).toContain('목록이 바뀌어서')
  expect(saved().length).toBe(3)

  expect((await run('todo')).text).toBe('a\n1. a1\n2. a2\n\nb\n3. b1')
  expect((await run('done 3')).text).toContain('b1')
  expect(saved().map((m: { text: string }) => m.text)).toEqual(['a1', 'a2'])
})

test('project 가 문자열이 아닌 메모는 기타로 보이고 패널이 그려진다', async ($, on) => {
  const { run } = await memoBoot($, on, [{ text: 'o1', project: { a: 1 } }])
  expect((await run('todo')).text).toBe('기타\n1. o1')
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /1\. o1/ }))?.text).toBeDefined()
  await ui.unmount()
})

test('할 일 메모는 todos.json 을 읽어 패널에 뜨고, todo·done 으로 고친다', async ($, on) => {
  const { run, saved } = await memoBoot($, on, [{ text: '첨부 업로드 presigned 로 개선', note: '근거 문서' }])

  expect((await run('todo 재측정')).text).toContain('1번')
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /1\. 재측정/ }))?.text).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /2\. 첨부 업로드/ }))?.text).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^2026-11-04$/ }))?.text).toBeDefined()
  expect(await run('todo 재측정2').then(() => run('todo'))).toMatchObject({ text: 'office\n2026-11-04\n1. 재측정\n2. 재측정2\n\n기타\n3. 첨부 업로드 presigned 로 개선' })
  await run('done 2')
  await ui.unmount()

  expect((await run('done 2')).text).toContain('첨부 업로드')
  expect(saved()).toEqual([{ text: '재측정', addedAt: '2026-11-04', project: 'office' }])
  expect((await run('todo')).text).toBe('office\n2026-11-04\n1. 재측정')
  expect((await run('done 9')).text).toContain('1~1')
})

test('할 일 메모를 프로젝트로 묶고, 옛 메모는 기타로, 번호와 done 이 맞는다', async ($, on) => {
  const { run, saved } = await memoBoot($, on, [
    { text: 'a1', addedAt: '2026-11-03', project: 'a' },
    { text: 'b1', addedAt: '2026-11-03', project: 'b' },
    { text: '옛 메모' },
    { text: 'a2', addedAt: '2026-11-03', project: 'a' },
    { text: 'a3', addedAt: '2026-11-04', project: 'a' },
  ])
  expect((await run('todo')).text).toBe('a\n2026-11-03\n1. a1\n2. a2\n\n2026-11-04\n3. a3\n\nb\n2026-11-03\n4. b1\n\n기타\n5. 옛 메모')

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^a$/ }))?.props.bold).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^기타$/ }))?.props.bold).toBe(true)
  // 같은 날짜여도 프로젝트가 바뀌면 다시 나온다
  const dates = await ui.findAll({ type: 'Text', text: /^2026-11-03$/ })
  expect(dates.length).toBe(2)
  expect(dates[0]?.props.color).toBe('cyan')
  expect((await ui.find({ type: 'Text', text: /4\. b1/ }))?.text).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /5\. 옛 메모/ }))?.text).toBeDefined()

  // 패널의 4번을 지우면 그 항목이 지워지고 뒤 번호가 당겨진다
  expect((await run('done 4')).text).toContain('b1')
  expect(saved().map((m: { text: string }) => m.text)).toEqual(['a1', 'a2', 'a3', '옛 메모'])
  expect((await ui.find({ type: 'Text', text: /4\. 옛 메모/ }))?.text).toBeDefined()
  await ui.unmount()
})

test('/office todo @폴더명 은 그 폴더로 묶어 저장하고, 내용이 없으면 저장하지 않는다', async ($, on) => {
  const { run, saved } = await memoBoot($, on, [{ text: 'x1', project: 'x' }, { text: '옛 메모' }, { text: 'y1', project: 'y' }])

  // 맨 끝이 아니라 x 묶음 안으로 들어가고, 그 번호를 알려 준다
  expect((await run('todo @x x2 내용')).text).toContain('2번')
  expect((await run('todo')).text).toBe('x\n1. x1\n\n2026-11-04\n2. x2 내용\n\ny\n3. y1\n\n기타\n4. 옛 메모')
  expect(saved()[1]).toEqual({ text: 'x2 내용', addedAt: '2026-11-04', project: 'x' })

  const before = saved()
  for (const args of ['todo @x', 'todo @', 'todo @ 내용']) expect((await run(args)).text).toContain('/office todo @폴더명 <내용>')
  expect(saved()).toEqual(before)
})

test('worktree 에서 추가한 메모는 폴더가 아니라 저장소 이름으로 묶는다', async ($, on) => {
  const { run, saved } = await memoBoot($, on, [], '/h/orca/workspaces/axacademy/feat-x', {
    'git rev-parse --path-format=absolute --git-dir --git-common-dir': '/h/dev/axacademy/.git/worktrees/feat-x\n/h/dev/axacademy/.git\n',
  })

  await run('todo 배지')
  expect(saved()).toEqual([{ text: '배지', addedAt: '2026-11-04', project: 'axacademy' }])
  expect((await run('todo')).text).toBe('axacademy\n2026-11-04\n1. 배지')
})
