import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { IdleRpgSave as Save } from '../types'
import { apply, fresh, join, levelOf, parseSave, stageOf } from './game'
import { amount, bandLayout, isMoving, newScene, paintScene, rowsOf, stepScene } from './register'
import { MOBS, SCENE } from './sprites'

const BAND = {
  plugin: 'idle-rpg',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 40, bodyColumns: 80, scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const NOON = new Date(2026, 10, 16, 12, 0).getTime()

/** Stands for the engine beneath: `world.usd` and `world.store` move as the test moves them. */
const engine = (on: On, store: Record<string, unknown> = {}) => {
  const world = {
    id: 'sess-a',
    usd: undefined as number | undefined,
    store: { ...store } as Record<string, any>,
    blits: 0,
    deny: undefined as string | undefined,
    failSets: 0,
    onSet: undefined as ((key: string) => void) | undefined,
    toasts: [] as string[],
  }
  on('ui.toast', (_, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('session.id', () => ({ value: world.id }))
  on('store.keys', () => ({ value: Object.keys(world.store) }))
  on('store.get', (_, e) => ({ value: world.store[e.key] }))
  on('store.set', (_, e) => {
    if (world.failSets-- > 0) throw new Error('EBUSY: the store file is locked')
    world.onSet?.(e.key)
    world.store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.usage', () => ({
    value: { startedAt: NOON, context: { window: 200_000 }, rateLimits: [], ...(world.usd === undefined ? {} : { cost: { usd: world.usd } }) },
  }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.blit', () => {
    world.blits++
    return { value: world.deny ? { deny: world.deny } : {} }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('classic.SessionStart', () => ({}))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  return world
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
const rpg = async ($: any, args = '') => (await $.command.run({ command: 'rpg', args })).text as string
const bill = ($: any, usd: number) =>
  $.session.measure({ context: { window: 200_000 }, rateLimits: [], cost: { usd }, changed: ['cost'] })
const endTurn = ($: any, agentId?: string) => $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer', ...(agentId ? { agentId } : {}) })
const stored = (over: Partial<Save>): Save => ({ ...fresh(), ...over })
/** What a session starting now would play on: every row in the store, joined. */
const saved = (world: { store: Record<string, unknown> }) =>
  Object.entries(world.store)
    .filter(([key]) => key === 'save' || key.startsWith('s:'))
    .map(([, row]) => parseSave(row))
    .reduce(join, fresh())
const drawn = async (ui: any) => JSON.stringify(await ui.drawn())

test('the band shows the status line on every surface, and the field only on the terminal', async ($, on) => {
  mock.clock(on, { now: NOON })
  engine(on, { save: stored({ exp: 300, gold: 42, kills: 13 }) })
  await start($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const line = await ui.find({ type: 'Text', text: /Lv\./ })
    expect(line?.text).toContain('Lv.2')
    expect(line?.text).toContain('스테이지 2-4')
    expect(line?.text).toContain('골드 42')
    expect((await drawn(ui)).includes('"Raster"')).toBe(surface === 'terminal')
    await ui.unmount()
  }
})

test('a short band, a collapsed one and a survey leave the field out', async ($, on) => {
  const clock = mock.clock(on, { now: NOON })
  const world = engine(on)
  await start($)

  const short = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, maxRows: 5 } })
  expect(await short.find({ type: 'Text', text: /Lv\.1/ })).toBeDefined()
  expect(await drawn(short)).not.toContain('"Raster"')
  await short.unmount()

  // Collapsed, nothing of the band is on screen: no field, and nothing drawn into it.
  const collapsed = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, isCollapsed: true } })
  expect(await drawn(collapsed)).not.toContain('"Raster"')
  await clock.advance(60_000)
  expect(world.blits).toBe(0)
  await collapsed.unmount()

  const survey = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
  expect(await survey.find({ type: 'Text', text: /Lv\./ })).toBeUndefined()
  await survey.unmount()
})

test('beside the taxi the row takes only what the taxi leaves of maxRows', () => {
  // The taxi's own rows: its 3 of text, and a road of up to 7 with a border of 2 where they fit.
  const taxi = (maxRows: number) => Math.min(maxRows, 12)
  const rows = { field: 6, line: 1, none: 0 }
  for (let maxRows = 6; maxRows <= 40; maxRows++) {
    expect(taxi(maxRows) + rows[bandLayout(maxRows, 72, taxi(maxRows))]).toBeLessThanOrEqual(maxRows)
  }
  expect([12, 13, 17, 18].map(maxRows => bandLayout(maxRows, 72, 12))).toEqual(['none', 'line', 'line', 'field'])
  // Alone it needs its own six rows, and the columns for the hero and a boss.
  expect([5, 6].map(maxRows => bandLayout(maxRows, 72, 0))).toEqual(['line', 'field'])
  expect(bandLayout(40, 39, 0)).toBe('line')
})

test('a row of another plugin in the band takes the field away where both do not fit', async ($, on) => {
  const clock = mock.clock(on, { now: NOON })
  engine(on)
  await start($)
  const props = { ...BAND.props, maxRows: 14 }
  // The taxi's row as it draws it, 12 rows: a bordered column of the road and three texts.
  const text = { type: 'Text', children: ['taxi'] }
  const road = { type: 'Raster', props: { key: 'road', columns: 72, rows: 7, cells: '' } }
  const taxi = { plugin: 'session-meter', tree: { type: 'Box', props: { flexDirection: 'column', borderStyle: 'round' }, children: [road, text, text, text] } }
  expect(rowsOf(taxi.tree)).toBe(12)
  // The office's: a column of its texts, the absent ones left as false.
  expect(rowsOf({ type: 'Box', props: { flexDirection: 'column' }, children: [text, false, [text, text], undefined] })).toBe(3)

  const alone = await $.ui.mount({ ...BAND, surface: 'terminal', props })
  expect(await drawn(alone)).toContain('"Raster"')
  const mine = await alone.drawn()
  await alone.unmount()

  // The band settles with the taxi's row in it; mounting this row alone settles it without.
  const settle = async () => {
    const list = await $.ui.mount({ plugin: '*', component: 'AbovePromptList', surface: 'terminal', props: { ...props, rows: [taxi, { plugin: 'idle-rpg', tree: mine }] } } as any)
    await clock.advance(1)
    await list.unmount()
  }

  await settle()
  const beside = await $.ui.mount({ ...BAND, surface: 'terminal', props })
  expect(await drawn(beside)).not.toContain('"Raster"')
  expect(await beside.find({ type: 'Text', text: /Lv\./ })).toBeDefined()
  await beside.unmount()

  await settle()
  const tight = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...props, maxRows: 12 } })
  expect(await tight.find({ type: 'Text', text: /Lv\./ })).toBeUndefined()
  await tight.unmount()
})

test('a tool call strikes, and the main turn end saves this session its own row', async ($, on) => {
  mock.clock(on, { now: NOON })
  const world = engine(on)
  await start($)

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await endTurn($, 'sub')
  expect(world.store['s:sess-a'].kills).toBe(0) // a subagent's turn end saves nothing

  await endTurn($)
  expect(world.store['s:sess-a']).toMatchObject({ kills: 1, gold: 5, exp: 6 })
  expect(world.store.save).toBeUndefined() // the save every session wrote is written no more
})

test('time passing attacks alike with the band up and without it', async ($, on) => {
  const clock = mock.clock(on, { now: NOON })
  const world = engine(on)
  await start($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await clock.advance(5000)
  expect(world.blits).toBeGreaterThan(0)
  await ui.unmount()
  await endTurn($)
  expect(saved(world).kills).toBe(1) // three attacks in 4.5s

  // A band gone from the screen refuses the next frame, and the timer ends with it.
  world.deny = 'nothing mounted'
  await clock.advance(1000)
  const before = world.blits
  await clock.advance(60 * 60_000)
  expect(world.blits).toBe(before)
  await endTurn($)
  // The hour counts in full, as it would have with the band up: 2400 attacks.
  expect(saved(world).kills).toBe(apply(fresh(), { type: 'tick', ms: 3_606_000 }, () => 0.99).save.kills)
})

test('an idle band draws once a second, a working one every frame', async ($, on) => {
  const clock = mock.clock(on, { now: NOON })
  const world = engine(on)
  await start($)

  const idle = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await clock.advance(60_000)
  expect(world.blits).toBeGreaterThan(50)
  expect(world.blits).toBeLessThanOrEqual(61)
  await idle.unmount()

  world.blits = 0
  const working = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, isWorking: true } })
  await clock.advance(10_000)
  expect(world.blits).toBeGreaterThan(60)
  await working.unmount()
})

test('spending gives exp once; a resumed bill and a cleared one give none', async ($, on) => {
  mock.clock(on, { now: NOON })
  const world = engine(on)
  world.usd = 4
  await start($)

  await bill($, 4.25)
  await bill($, 4.25)
  await endTurn($)
  expect(saved(world).exp).toBe(250)

  world.usd = 90
  await $.classic.SessionStart({ source: 'resume', session_id: 'other' })
  await bill($, 90)
  await endTurn($)
  expect(saved(world).exp).toBe(250)

  await $.classic.SessionStart({ source: 'clear', session_id: 'new' })
  await bill($, 0.5)
  await endTurn($)
  expect(saved(world).exp).toBe(750)
})

test('ten-cent bills reach the level their dollars buy', async ($, on) => {
  mock.clock(on, { now: NOON })
  const world = engine(on)
  world.usd = 4
  await start($)
  for (const usd of [4.1, 4.2, 4.3]) await bill($, usd)
  await endTurn($)
  expect(saved(world).exp).toBe(300)
  expect(await rpg($)).toContain('Lv.2')
})

test('a reload mid-turn keeps the spending since the last bill', async ($, on) => {
  mock.clock(on, { now: NOON })
  const world = engine(on)
  world.usd = 4
  await start($)
  await bill($, 4.5)

  // The session has spent to $6, no bill has said so yet, and the mod reloads.
  world.usd = 6
  await start($)
  await bill($, 6)
  await endTurn($)
  expect(saved(world).exp).toBe(2000)
})

test('a new session takes up the monster where the last one left it', async ($, on) => {
  mock.clock(on, { now: NOON })
  engine(on, { save: stored({ kills: 9, dmg: 150 }) })
  await start($)
  expect(await rpg($)).toContain('레거시 골렘 50/200')
})

test('two sessions hunting side by side stay at the stage they fought to, and both are paid', async ($, on) => {
  const clock = mock.clock(on, { now: NOON })
  const world = engine(on)
  await start($)
  await clock.advance(3_600_000)

  // A second terminal did the same hour from the same empty store, and saved first.
  const twin = apply(fresh(), { type: 'tick', ms: 3_600_000 }, () => 0.99).save
  world.store['s:sess-b'] = twin
  await endTurn($)
  expect(world.store['s:sess-b']).toEqual(twin) // nobody writes another session's row

  const all = saved(world)
  expect(stageOf(all.kills)).toBe(stageOf(twin.kills))
  expect(all.gold).toBe(twin.gold * 2)
  // The next look at the store brings the other session's gold in.
  expect(await rpg($)).toContain(`골드 ${amount(twin.gold * 2)}`)
})

test('another session saving at the same instant loses nothing', async ($, on) => {
  mock.clock(on, { now: NOON })
  const world = engine(on, { save: stored({ gold: 100 }) })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'ls' }) // this session: 1 kill, 5 gold

  // The other session, started from the same 100 gold, saves 50 gold and 10 kills mid-save.
  world.onSet = key => {
    if (key === 's:sess-a') world.store['s:sess-b'] = stored({ gold: 50, kills: 10 })
  }
  await endTurn($)
  expect(saved(world)).toMatchObject({ gold: 155, kills: 10 })
})

test('a save that fails is made good by the next, and counts nothing twice', async ($, on) => {
  mock.clock(on, { now: NOON })
  const world = engine(on, { save: stored({ gold: 1000, kills: 50 }), 's:sess-b': stored({ gold: 100, kills: 30 }) })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const tool = { type: 'tool' } as const
  const after = apply(apply(stored({ gold: 1100, kills: 50 }), tool, () => 0.99).save, tool, () => 0.99).save
  expect(after.kills).toBe(51)

  world.failSets = 1
  await endTurn($)
  expect(world.store['s:sess-a'].gold).toBe(0) // the write was lost, and the turn ended all the same
  await endTurn($)
  expect(saved(world)).toMatchObject({ gold: after.gold, kills: 51 })
  await rpg($)
  await endTurn($)
  expect(saved(world)).toMatchObject({ gold: after.gold, kills: 51 })
})

test('a /clear moves the session: the old row keeps its share and the new one starts', async ($, on) => {
  mock.clock(on, { now: NOON })
  const world = engine(on)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await endTurn($)

  world.id = 'sess-b'
  await $.classic.SessionStart({ source: 'clear', session_id: 'sess-b' })
  expect(world.store['s:sess-a']).toMatchObject({ gold: 5, kills: 1 })
  expect(world.store['s:sess-b']).toMatchObject({ gold: 0, kills: 1 })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await endTurn($)
  expect(saved(world)).toMatchObject({ gold: 10, kills: 2 })
})

test('a resumed session goes on from its own row', async ($, on) => {
  mock.clock(on, { now: NOON })
  const world = engine(on, { 's:sess-a': stored({ gold: 40, kills: 12, enhance: 2 }), 's:sess-b': stored({ gold: 10 }) })
  await start($)
  expect(await rpg($)).toContain('골드 50')
  expect(world.store['s:sess-a']).toMatchObject({ gold: 40, kills: 12, enhance: 2 })
})

test('/rpg reports, buys and saves each purchase', async ($, on) => {
  mock.clock(on, { now: NOON })
  const world = engine(on, { save: stored({ exp: 300, gold: 200 }) })
  await start($)

  const status = await rpg($)
  for (const part of ['Lv.2', '스테이지 1-1', '골드 200', '세미콜론 벌레', '무기 없음', '남은 포인트 1', '다음 강화: 50골드', '/rpg 강화 최대', '/rpg 뽑기', '/rpg 스킬 황금손', '/rpg 끄기']) {
    expect(status).toContain(part)
  }

  expect(await rpg($, '뽑기')).toContain('골드가 부족해요')
  expect(await rpg($, '강화')).toContain('강화 +1 성공')
  expect(saved(world)).toMatchObject({ gold: 150, enhance: 1 })
  expect(world.store['s:sess-a']).toMatchObject({ gold: -50, enhance: 1 }) // it spent what the old save held

  // 55 + 61 = 116 <= 150, and a third at 67 is too much.
  expect(await rpg($, '강화 최대')).toContain('강화 +3 성공 (2번)')
  expect(saved(world)).toMatchObject({ gold: 34, enhance: 3 })
  expect(await rpg($, '강화 최대')).toContain('골드가 부족해요')

  expect(await rpg($, '스킬 황금손')).toContain('황금손 Lv.1')
  expect(saved(world).skills.greed).toBe(1)
  expect(await rpg($, '스킬 황금손')).toContain('스킬 포인트가 없어요')
  expect(await rpg($, '스킬 불꽃')).toContain('연속베기, 급소찌르기, 황금손')
  expect(await rpg($, '춤')).toContain('모르는 명령')
})

test('/rpg says what attack a waiting boss asks for', async ($, on) => {
  mock.clock(on, { now: NOON })
  engine(on, { save: stored({ kills: 209 }) })
  await start($)
  expect(await rpg($)).toContain('보스 레거시 골렘은 공격력 137부터 나와요')
})

test('/rpg 뽑기 spends 300 gold on a piece of gear', async ($, on) => {
  mock.clock(on, { now: NOON })
  const world = engine(on, { save: stored({ gold: 300 }) })
  await start($)

  expect(await rpg($, '뽑기')).toContain('뽑기 결과')
  expect(saved(world).gold).toBe(0)
  const { weapon, armor, ring } = saved(world).gear
  expect(weapon + armor + ring).toBeGreaterThan(0)
})

test('/rpg 끄기 hides the band and the next session remembers', async ($, on) => {
  mock.clock(on, { now: NOON })
  const world = engine(on)
  await start($)

  expect(await rpg($, '끄기')).toContain('껐어요')
  expect(world.store.on).toBe(false)
  const off = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await off.find({ type: 'Text', text: /Lv\./ })).toBeUndefined()
  await off.unmount()

  await start($)
  const still = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await still.find({ type: 'Text', text: /Lv\./ })).toBeUndefined()
  await still.unmount()

  await rpg($, '켜기')
  const back = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await back.find({ type: 'Text', text: /Lv\./ })).toBeDefined()
  await back.unmount()
})

test('a hit swings, flashes the monster white, floats its damage, and a kill walks the next one in', () => {
  const cols = 60
  const hex = (name: keyof typeof SCENE) => Number.parseInt(SCENE[name].slice(1), 16)
  const count = (p: Uint32Array, color: number) => p.filter(c => c === color).length
  const view = { kills: 0, boss: false, left: 1 }

  const scene = newScene()
  const still = paintScene(scene, view, cols)
  expect(isMoving(scene)).toBe(false)
  expect(count(still, hex('flash'))).toBe(0)
  // The bar is as wide as the monster: half of it goes with half the hp.
  const wide = MOBS[0]?.[0]?.length ?? 0
  expect(count(still, hex('hp')) - count(paintScene(scene, { kills: 0, boss: false, left: 0.5 }, cols), hex('hp'))).toBe(wide - Math.round(wide / 2))

  scene.queue.push({ dmg: 12, crit: true, killed: true, boss: false, advanced: true })
  stepScene(scene)
  expect(isMoving(scene)).toBe(true)
  stepScene(scene)
  stepScene(scene)
  const struck = paintScene(scene, view, cols)
  expect(count(struck, hex('flash'))).toBeGreaterThan(20)
  expect(count(struck, hex('crit'))).toBeGreaterThan(10) // "12" in the crit color

  for (let i = 0; i < 3; i++) stepScene(scene)
  expect(scene.enter).toBeGreaterThan(0)
  for (let i = 0; i < 20; i++) stepScene(scene)
  expect(isMoving(scene)).toBe(false)
})

test('a long catch-up toasts each kind of news once, and a rescan that raises the level stays quiet', async ($, on) => {
  const clock = mock.clock(on, { now: NOON })
  const world = engine(on)
  await start($)

  await clock.advance(8 * 3_600_000)
  await endTurn($)
  const caught = apply(fresh(), { type: 'tick', ms: 8 * 3_600_000 }, () => 0.99)
  expect(caught.hits.filter(h => h.boss && h.killed).length).toBeGreaterThan(5)
  const kinds = world.toasts.map(text => text.split('!')[0])
  expect(kinds).toEqual(['레벨 업', '보스 레거시 골렘 처치', '전직 가능'])
  expect(world.toasts[0]).toContain(`스킬 포인트 +${levelOf(caught.save.exp) - 1}`)

  // Another session's progress, read in, toasts nothing here.
  world.toasts = []
  world.store['s:sess-b'] = stored({ exp: 1e7 })
  await rpg($, '끄기')
  expect(saved(world).exp).toBeGreaterThan(1e7)
  expect(world.toasts).toEqual([])
})

test('felling the examiner toasts the 전직 with the new name', async ($, on) => {
  const clock = mock.clock(on, { now: NOON })
  const world = engine(on, { save: { ...stored({ exp: 6802 }), job: { line: null, tier: 0, at: 1, trial: { line: 'rogue', hp: 600 } } } })
  await start($)
  await clock.advance(60_000)
  await endTurn($)
  expect(world.toasts).toContain('전직 완료! 이제 핫픽스 도적')
  expect(saved(world).job).toMatchObject({ line: 'rogue', tier: 1 })
})
