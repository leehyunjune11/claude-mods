import { expect, test } from 'claude-code/testing'

const FILE = {
  date: '2026-11-16',
  tasks: [
    { id: 'fw', sec: 'BOSS', boss: true, t: '고객사 교안 전달', xp: 150 },
    { id: 'm1', sec: '메인', t: '계약서 확인', xp: 60, due: '2026-11-18' },
    { id: 'z', sec: '잡몹', t: 'Tally 초대', xp: 5, done: true, doneAt: '2026-11-16' },
  ],
}

const seed = (on: any) =>
  on('state.get', (_: any, e: any) => {
    const v = { data: FILE, combo: 0, isAdding: false, isPicking: false, picked: [] }[(e.key ?? e.ref?.key) as string]
    return { value: { value: v, version: 1 } }
  })

test('패널과 입력창 위 띠가 터미널에서 그려진다', async ($, on) => {
  seed(on)
  on('clock.now', () => ({ value: Date.parse('2026-11-16T03:00:00Z') }))
  const pane = await $.ui.mount({
    plugin: 'quest-board',
    component: 'Pane',
    requestId: 'quest',
    surface: 'terminal',
    props: { title: 'Quest', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as any)
  expect((await pane.find({ key: 'm1' }))).toBeDefined()
  await pane.unmount()

  const band = await $.ui.mount({
    plugin: 'quest-board',
    component: 'AbovePrompt',
    surface: 'terminal',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, rows: 20 },
  } as any)
  expect((await band.find({ type: 'Text', text: /LV\./ }))).toBeDefined()
  expect((await band.find({ key: 'scene' }))).toBeDefined()
  expect((await band.find({ type: 'Text', text: /킹슬라임/ }))).toBeDefined()
  await band.unmount()
})
