import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  addDays,
  bandRows,
  dayKey,
  isMoving,
  isTaxiAnimated,
  mergeBackfill,
  meterFits,
  meterReport,
  newScene,
  taxiSvg,
  paintScene,
  stepScene,
  taxiLayout,
  wrappedRows,
  taxiFrame,
  totalsRow,
  weekStart,
} from './register'

const SID = 'sess-a'

const BAND = {
  plugin: 'session-meter',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, maxRows: 40, bodyColumns: 80, scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const measure = (changed: ('context' | 'rateLimits' | 'cost')[], fivePct = 41, usd = 1.234) => ({
  context: { window: 200_000, tokens: 24_000, percent: 12 },
  rateLimits: [{ kind: 'five_hour', percentUsed: fivePct }],
  cost: { usd },
  changed,
})

const cost = (usd: number) => measure(['context', 'cost'], 41, usd)

const bandRow = async ($: any, text: RegExp, surface = 'terminal') => {
  const ui = await $.ui.mount({ ...BAND, surface })
  const row = await ui.find({ type: 'Text', text })
  await ui.unmount()
  return row?.text as string | undefined
}


const totalsText = async ($: any) => {
  const ui = await $.ui.mount(BAND)
  const row = await ui.find({ type: 'Text', text: /^오늘 / })
  await ui.unmount()
  return row?.text as string | undefined
}

/** Stands for the engine beneath: `world.id` and `world.usd` move as the test moves them. */
const engine = (on: On, store: Record<string, unknown> = {}, seed = { id: SID, usd: 0 }) => {
  const world = { ...seed, startedAt: NOV_4, store: { ...store } as Record<string, any>, closed: [] as string[], invalidated: 0 }
  on('store.get', (_, e) => ({ value: world.store[e.key] }))
  on('store.set', (_, e) => {
    world.store[e.key] = e.value
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(world.store) }))
  on('session.id', () => ({ value: world.id }))
  on('session.usage', () => ({
    value: { startedAt: world.startedAt, context: { window: 200_000 }, rateLimits: [], cost: { usd: world.usd } },
  }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.close', (_, e) => {
    world.closed.push(e.id)
    return { value: undefined }
  })
  on('ui.invalidate', () => {
    world.invalidated++
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('classic.SessionStart', () => ({}))
  return world
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

const run = ($: any, args = '', command = 'meter') => $.command.run({ command, args })

const NOV_4 = new Date(2026, 10, 4, 12, 0).getTime() // a Wednesday

const close = (actual: number, want: number) => expect(Math.abs(actual - want)).toBeLessThan(1e-9)

test('the box shows the figures and the cache counts down', async ($, on) => {
  const clock = mock.clock(on, { now: NOV_4 })
  engine(on)
  on('ui.blit', () => ({ value: {} }))

  await start($)
  await $.session.measure(measure(['context', 'rateLimits', 'cost']))
  // The cache and 5시간 stay off the fuel row.
  expect(await bandRow($, /^연료/)).toBe('연료 █████████░ 88%')
  expect(await bandRow($, /^이번 운행/, 'desktop')).toBe('이번 운행 $1.23   빈차   운행 0분   캐시 60분')
  expect((await run($)).text).toContain('5시간 ████░░░░░░ 41%')
  expect((await run($)).text).toContain('🚕 $1.23')
  expect((await run($)).text).toContain('캐시 60분')

  await clock.advance(52 * 60_000)
  expect(await bandRow($, /^이번 운행/, 'desktop')).toContain('캐시 8분')

  // A subagent's rate-limit tick does not reset the cache clock.
  await $.session.measure(measure(['rateLimits'], 42))
  expect(await bandRow($, /^이번 운행/, 'desktop')).toContain('캐시 8분')

  await clock.advance(8 * 60_000)
  expect(await bandRow($, /^이번 운행/, 'desktop')).toContain('캐시 만료')
})

test('a fork starts from its restored cost: the parent is not billed twice', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  const world = engine(on, {}, { id: 'fork', usd: 0.0333 })

  await start($)
  await $.session.measure(cost(0.05))

  const row = world.store['s:fork'] as any
  close(row.days[dayKey(NOV_4)], 0.05 - 0.0333)
  close(row.lastCost, 0.05)
})

test('a resume continues from its stored row', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  const world = engine(on, { [`s:${SID}`]: { lastCost: 2, days: { '2026-11-01': 2 } } }, { id: SID, usd: 2 })

  await start($)
  await $.session.measure(cost(2.5))

  const row = world.store[`s:${SID}`] as any
  close(row.days['2026-11-01'], 2)
  close(row.days[dayKey(NOV_4)], 0.5)
})

test('a hot reload keeps the ledger: a second start does not bill or lose anything', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  const world = engine(on)

  await start($)
  await $.session.measure(cost(1))
  world.usd = 1
  await start($)
  await $.session.measure(cost(1.5))

  close(world.store[`s:${SID}`].days[dayKey(NOV_4)], 1.5)
})

test('a falling cost adds nothing, then counts from the lower figure', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  const world = engine(on)

  await start($)
  await $.session.measure(cost(5))
  await $.session.measure(cost(3))

  let row = world.store[`s:${SID}`] as any
  close(row.days[dayKey(NOV_4)], 5)
  close(row.lastCost, 3)

  await $.session.measure(cost(3.5))
  row = world.store[`s:${SID}`] as any
  close(row.days[dayKey(NOV_4)], 5.5)
})

test('/clear starts a fresh ledger, counts the first measure in full and rescans at once', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  const world = engine(on)
  on('ui.blit', () => ({ value: {} }))

  await start($)
  await $.session.measure(cost(4))
  world.usd = 4
  await $.session.end({ reason: 'clear', sessionId: SID, resume: { id: SID } } as any)
  world.id = 'sess-b'
  world.usd = 0
  await $.classic.SessionStart({ source: 'clear', session_id: 'sess-b' })
  world.usd = 0.25

  await $.session.measure(cost(0.25))
  close(world.store['s:sess-b'].days[dayKey(NOV_4)], 0.25)
  close(world.store[`s:${SID}`].days[dayKey(NOV_4)], 4)
  // Without the rescan at /clear the old session's $4 would be missing for up to a minute.
  expect(await totalsText($)).toBe('오늘 $4.25   이번 주 $4.25   이번 달 $4.25')
})

test('session.end records what no measure reported', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  const world = engine(on)

  await start($)
  await $.session.measure(cost(1))
  world.usd = 1.75
  await $.session.end({ reason: 'other', sessionId: SID, resume: { id: SID } } as any)

  const row = world.store[`s:${SID}`] as any
  close(row.days[dayKey(NOV_4)], 1.75)
  close(row.lastCost, 1.75)
})

test('/clear: the final delta lands on the ending session even when the id has already moved', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  const world = engine(on)

  await start($)
  await $.session.measure(cost(4))
  // The engine has already switched: $.session.id() answers the new id during the old one's end.
  world.id = 'sess-b'
  world.usd = 4.5
  await $.session.end({ reason: 'clear', sessionId: SID, resume: { id: SID } } as any)

  close(world.store[`s:${SID}`].days[dayKey(NOV_4)], 4.5)
  close(world.store[`s:${SID}`].lastCost, 4.5)
  expect(world.store['s:sess-b']).toBeUndefined()

  world.usd = 0
  await $.classic.SessionStart({ source: 'clear', session_id: 'sess-b' })
  await $.session.measure(cost(0.25))
  close(world.store['s:sess-b'].days[dayKey(NOV_4)], 0.25)
  close(world.store[`s:${SID}`].days[dayKey(NOV_4)], 4.5)
})

test('a session that spent nothing leaves no row', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  const world = engine(on)
  await start($)
  await $.session.end({ reason: 'other', sessionId: SID, resume: { id: SID } } as any)
  expect(world.store[`s:${SID}`]).toBeUndefined()
})

test("a session end reading the next session's lower cost keeps the old row resumable", async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  const world = engine(on)

  await start($)
  await $.session.measure(cost(4.1))
  world.usd = 0
  await $.session.end({ reason: 'clear', sessionId: SID, resume: { id: SID } } as any)
  close(world.store[`s:${SID}`].lastCost, 4.1)
})

test('an in-process resume bills the ending session nothing and clears its figures', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  const world = engine(on)

  await start($)
  await $.session.measure(cost(4))
  world.usd = 10
  await $.session.end({ reason: 'resume', sessionId: SID, resume: { id: 'other' } } as any)
  close(world.store[`s:${SID}`].lastCost, 4)
  close(world.store[`s:${SID}`].days[dayKey(NOV_4)], 4)
  expect((await $.command.run({ command: 'meter', args: '' } as any)).text).not.toContain('🚕 $4')
})

test('a session end the ledger no longer holds rewrites nothing', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  const world = engine(on, { 's:gone': { lastCost: 7, days: { '2026-11-01': 7 } } })

  await start($)
  world.usd = 0
  await $.session.end({ reason: 'other', sessionId: 'gone', resume: { id: 'gone' } } as any)
  expect(world.store['s:gone'].lastCost).toBe(7)
})

test('a session id that moved in process is never written under the old key', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  const world = engine(on, { 's:other': { lastCost: 3, days: { '2026-11-01': 3 } } })

  await start($)
  await $.session.measure(cost(1))
  world.id = 'other'
  world.usd = 3
  await $.session.measure(cost(3.5))

  close(world.store[`s:${SID}`].lastCost, 1)
  const row = world.store['s:other'] as any
  close(row.days['2026-11-01'], 3)
  close(row.days[dayKey(NOV_4)], 0.5)
})

test('a cost that crosses midnight lands on the new local day', async ($, on) => {
  const beforeMidnight = new Date(2026, 10, 3, 23, 59).getTime()
  const clock = mock.clock(on, { now: beforeMidnight })
  const world = engine(on)

  await start($)
  await $.session.measure(cost(1))
  await clock.advance(2 * 60_000)
  await $.session.measure(cost(1.5))

  const row = world.store[`s:${SID}`] as any
  close(row.days['2026-11-03'], 1)
  close(row.days['2026-11-04'], 0.5)
})

test('weeks start on Monday, Sunday included in the week before it', () => {
  expect(weekStart('2026-11-02')).toBe('2026-11-02') // Monday
  expect(weekStart('2026-11-08')).toBe('2026-11-02') // Sunday
  expect(weekStart('2026-11-09')).toBe('2026-11-09') // the next Monday
  expect(weekStart('2026-11-01')).toBe('2026-10-26') // a Sunday across a month
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01')

  const l = { id: SID, lastCost: 0, days: { '2026-11-01': 1, '2026-11-02': 10, '2026-11-08': 100, '2026-11-09': 1000 } }
  const t = { others: {}, backfill: {} }
  expect(totalsRow(t, l, '2026-11-08')).toBe('오늘 $100.00   이번 주 $110.00   이번 달 $1111.00')
  expect(totalsRow(t, l, '2026-11-09')).toBe('오늘 $1000.00   이번 주 $1000.00   이번 달 $1111.00')
})

test('months split at their boundary', () => {
  const l = { id: SID, lastCost: 0, days: { '2026-10-31': 7, '2026-11-01': 3 } }
  const t = { others: {}, backfill: {} }
  // The same Sunday-ending week holds both days; the months keep them apart.
  expect(totalsRow(t, l, '2026-11-01')).toBe('오늘 $3.00   이번 주 $10.00   이번 달 $3.00')
  expect(totalsRow(t, l, '2026-10-31')).toBe('오늘 $7.00   이번 주 $10.00   이번 달 $7.00')
})

test('totals sum every session and the backfill, with this session live', async ($, on) => {
  const today = dayKey(NOV_4)
  mock.clock(on, { now: NOV_4 })
  const stale = { lastCost: 1, days: { [today]: 1 } }
  engine(
    on,
    {
      [`s:${SID}`]: stale,
      's:b': { lastCost: 2, days: { [today]: 2 } },
      's:c': { lastCost: 4, days: { [today]: 4 } },
      backfill: { days: { [today]: 8 }, dataStart: '2026-09-07' },
      unrelated: { days: { [today]: 1000 } },
    },
    { id: SID, usd: 1 },
  )
  on('ui.blit', () => ({ value: {} }))

  await start($)
  await $.session.measure(cost(1.5))

  // 1.5 (own, live; not the stale 1 on top) + 2 + 4 + 8.
  expect(await totalsText($)).toBe('오늘 $15.50   이번 주 $15.50   이번 달 $15.50')
  const report = (await run($)).text as string
  expect(report).toContain('오늘 $15.50')
  expect(report).toContain('이번 달 $15.50')
})

test('/meter tables mark estimates and the partial month', () => {
  const report = meterReport(
    { limits: [], now: NOV_4 },
    {
      others: { '2026-11-03': 5 },
      backfill: { '2026-09-10': 100, '2026-10-05': 200, '2026-11-02': 10 },
      dataStart: '2026-09-07',
    },
    { id: SID, lastCost: 0, days: { '2026-11-04': 1 } },
    '2026-11-04',
  )
  const line = (start: string) => report.split('\n').find(r => r.trim().startsWith(start))

  expect(line('2026-09')).toContain('$100.00')
  expect(line('2026-09')).toContain('(추정) 부분 집계')
  expect(line('2026-10')).toContain('$200.00')
  expect(line('2026-10')).toMatch(/\(추정\)$/)
  expect(line('2026-11')).toContain('$16.00')
  expect(line('2026-11')).toMatch(/\(일부 추정\)$/)
  // November's weeks from their Mondays: Oct 26 (backfill Oct 5 is outside it) and Nov 2.
  expect(line('10/26~11/01')).toContain('$0.00')
  expect(line('11/02~11/08')).toContain('$16.00')
  expect(report).toContain('이번 주 $16.00 (일부 추정)')
  expect(report).toContain('오늘 $1.00')
  expect(report).not.toContain('오늘 $1.00 (')
})

test('a period with only live figures carries no mark', () => {
  const report = meterReport(
    { limits: [], now: NOV_4 },
    { others: {}, backfill: {} },
    { id: SID, lastCost: 0, days: { '2026-11-04': 1 } },
    '2026-11-04',
  )
  expect(report).not.toContain('추정)')
  expect(report).not.toContain('부분 집계')
})

test('a re-run of the backfill merges per day and never lowers a day', () => {
  const merged = mergeBackfill(
    { days: { '2026-09-01': 5, '2026-09-02': 5 }, dataStart: '2026-09-01' },
    { days: { '2026-09-02': 3, '2026-09-03': 3 }, dataStart: '2026-09-02' },
  )
  expect(merged).toEqual({ days: { '2026-09-01': 5, '2026-09-02': 5, '2026-09-03': 3 }, dataStart: '2026-09-01' })
})

test('/meter backfill passes the fixed cutoff, merges and reports', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  const world = engine(on, {
    liveStart: '2026-11-04T01:00:00.000Z',
    backfill: { days: { '2026-09-07': 50 }, dataStart: '2026-09-07' },
  })
  let argv: readonly string[] = []
  on('process.run', (_, e) => {
    argv = e.argv
    return {
      value: {
        exitCode: 0,
        stdout: JSON.stringify({ days: { '2026-09-07': 40, '2026-09-08': 10 }, dataStart: '2026-09-08', unpriced: {} }),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })

  await start($)
  const { text } = await run($, 'backfill')

  expect(argv[0]).toBe('/usr/bin/python3')
  expect(argv.at(-1)).toBe('2026-11-04T01:00:00.000Z')
  expect(text).toContain('$60.00')
  expect(text).toContain('2026-09-07 ~ 2026-09-08')
  expect(world.store.backfill).toEqual({ days: { '2026-09-07': 50, '2026-09-08': 10 }, dataStart: '2026-09-07' })
})

test('liveStart is written once', async ($, on) => {
  const clock = mock.clock(on, { now: NOV_4 })
  const world = engine(on)
  await start($)
  const first = world.store.liveStart
  expect(first).toBe(new Date(NOV_4).toISOString())
  await clock.advance(60_000)
  await start($)
  expect(world.store.liveStart).toBe(first)
})

const DRIVE = { mode: 'drive', gas: false, bg: 0, agents: 0 } as const
const ARRIVE = { mode: 'arrive', gas: false, bg: 0, agents: 0 } as const
const IDLE = { mode: 'idle', gas: false, bg: 0, agents: 0 } as const
const ROOF = 0xffc92e
const CAR_X = 14

const carTop = (s: ReturnType<typeof newScene>, x: Parameters<typeof paintScene>[1]) => {
  const p = paintScene(s, x, 72)
  for (let y = 0; y < 16; y++) if (p[y * 72 + CAR_X + 7] === ROOF) return y
  throw new Error('no car')
}

test('a driving car keeps a straight line; a stopped car holds still', () => {
  const s = newScene()
  const tops = new Set<number>()
  for (let i = 0; i < 40; i++) {
    stepScene(s, DRIVE, 72)
    tops.add(carTop(s, DRIVE)) // no bump: one height from the first frame
  }
  expect([...tops]).toEqual([5])
  expect(isMoving(s, DRIVE)).toBe(true)

  for (let i = 0; i < 60; i++) stepScene(s, ARRIVE, 72)
  expect(s.speed).toBe(0)
  expect(isMoving(s, ARRIVE)).toBe(false)
  const before = s.scroll
  const stopped = new Set<number>()
  for (let i = 0; i < 12; i++) {
    stepScene(s, ARRIVE, 72)
    stopped.add(carTop(s, ARRIVE))
  }
  expect([...stopped]).toEqual([5])
  expect(s.scroll).toBe(before)
})

test('a tool call drops a bump just ahead: front wheel, then rear, the body one pixel, a fare float', () => {
  const wheelTop = (s: ReturnType<typeof newScene>, col: number) => {
    const p = paintScene(s, DRIVE, 72)
    for (let y = 0; y < 16; y++) if (p[y * 72 + col] === 0x5a5f70 || p[y * 72 + col] === 0xc9ccd6) return y
    throw new Error('no wheel')
  }
  const s = newScene()
  for (let i = 0; i < 40; i++) stepScene(s, DRIVE, 72)
  s.wantBump = true
  stepScene(s, DRIVE, 72)
  const bump = s.bump
  expect(bump?.x).toBeGreaterThan(CAR_X + 19)
  expect(bump?.x).toBeLessThanOrEqual(CAR_X + 28)

  // One at a time: a call while it is on screen does not replace it.
  const before = bump?.x ?? 0
  s.wantBump = true
  stepScene(s, DRIVE, 72)
  expect(s.bump).toBe(bump)
  expect(s.bump?.x).toBeLessThan(before)

  const tops = new Set<number>()
  let frontUp = -1
  let rearUp = -1
  let hitAt = -1
  let floated = false
  for (let i = 2; i < 60; i++) {
    if (s.bump?.hit && hitAt < 0) hitAt = i
    floated ||= s.floats.length > 0
    tops.add(carTop(s, DRIVE))
    // The wheels' outer column, wide only in their middle row (12 on the road): a strut never reaches it.
    if (frontUp < 0 && wheelTop(s, CAR_X + 16) < 12) frontUp = i
    if (rearUp < 0 && wheelTop(s, CAR_X + 4) < 12) rearUp = i
    stepScene(s, DRIVE, 72)
  }
  expect(hitAt).toBeGreaterThan(0)
  expect(hitAt).toBeLessThanOrEqual(12) // frames from the spawn, at full speed
  expect(floated).toBe(true)
  expect([...tops].sort((p, q) => q - p)).toEqual([5, 4]) // at rest 5, lifted 1
  expect(frontUp).toBeGreaterThan(0)
  expect(rearUp).toBeGreaterThan(frontUp)
  expect(s.bump).toBeUndefined()
})

test('the bump is two rows of stripes every 2 pixels, and goes when the car stops', () => {
  const s = { ...newScene(), speed: 1, bump: { x: 50, hit: true } }
  const p = paintScene(s, DRIVE, 72)
  const row = (y: number, from: number, to: number) => Array.from(p.slice(y * 72 + from, y * 72 + to))
  const [Y, G] = [0xf0c040, 0x5a5f70]
  expect(row(13, 50, 58)).toEqual([Y, Y, G, G, Y, Y, G, G])
  expect(row(12, 51, 57)).toEqual([Y, G, G, Y, Y, G])

  for (let i = 0; i < 60; i++) stepScene(s, ARRIVE, 72)
  expect(s.speed).toBe(0)
  expect(s.bump).toBeUndefined()
  expect(isMoving(s, ARRIVE)).toBe(false)
})

test('the flag shows only stopped at arrival; for hire the whole frame holds still, lamp steady', () => {
  const flag = (p: Uint32Array) => p[50]
  const s = newScene()
  expect(flag(paintScene(s, ARRIVE, 72))).toBe(0x1b1d24)
  expect(flag(paintScene(s, IDLE, 72))).not.toBe(0x1b1d24)

  const painted = () => Array.from(paintScene(s, IDLE, 72)).join()
  const first = painted()
  expect(paintScene(s, IDLE, 72)[3 * 72 + CAR_X + 8]).toBe(0xff4d3d)
  for (let i = 0; i < 4; i++) {
    stepScene(s, IDLE, 72, 8)
    expect(painted()).toBe(first)
  }
})

test('the lamp blinks amber only for background work, and never while driving', () => {
  const lampAt = (s: ReturnType<typeof newScene>, x: Parameters<typeof paintScene>[1]) => {
    stepScene(s, x, 72, 8)
    return paintScene(s, x, 72)[3 * 72 + CAR_X + 8] as number
  }
  for (const mode of ['idle', 'arrive'] as const) {
    const s = newScene()
    const x = { mode, gas: false, bg: 1, agents: 0 }
    expect([lampAt(s, x), lampAt(s, x)].sort((p, q) => p - q)).toEqual([0x6b4a0e, 0xffb020])
  }

  const s = newScene()
  const x = { mode: 'drive', gas: false, bg: 2, agents: 0 } as const
  expect([lampAt(s, x), lampAt(s, x)]).toEqual([0xf4f4f4, 0xf4f4f4]) // the sign, no lamp on it
})

test('subagents drive after the main turn ended, with no lamp, whatever the mode', () => {
  const lamp = (x: Parameters<typeof paintScene>[1]) => paintScene(newScene(), x, 72)[3 * 72 + CAR_X + 8]
  for (const mode of ['idle', 'arrive'] as const) {
    const x = { mode, gas: false, bg: 2, agents: 1 }
    const s = newScene()
    expect(isMoving(s, x)).toBe(true) // from a standstill: the fast timer gets it going
    for (let i = 0; i < 40; i++) stepScene(s, x, 72)
    expect(s.speed).toBeGreaterThan(0.9)
    expect(isMoving(s, x)).toBe(true)
    expect(lamp(x)).toBe(0xf4f4f4) // the sign
    const parked = { ...x, agents: 0 }
    for (let i = 0; i < 60; i++) stepScene(s, parked, 72)
    expect(s.speed).toBe(0)
    expect(isMoving(s, parked)).toBe(false)
    expect([0xffb020, 0x6b4a0e]).toContain(lamp(parked))
  }
  const fueling = { mode: 'idle', gas: true, bg: 0, agents: 1 } as const
  expect(isMoving(newScene(), fueling)).toBe(false)
})

const LED_POINT = (cols: number) => 8 * cols + cols - 28 + 14 // the decimal point: lit at any fare

test('the meter fits from 76 columns, 7 rows and under $1000', () => {
  expect(meterFits(76, 7, 999.99)).toBe(true)
  expect(meterFits(75, 7, 1)).toBe(false)
  expect(meterFits(76, 6, 1)).toBe(false)
  expect(meterFits(76, 7, 1000)).toBe(false)
  // What rounds to 1000.00 has no digit to show it: text, not 000.00.
  expect(meterFits(76, 7, 999.994)).toBe(true)
  expect(meterFits(76, 7, 999.996)).toBe(false)

  const hasPanel = (cols: number, rows: number, fareTo: number) =>
    paintScene({ ...newScene(), fareTo }, IDLE, cols, rows).includes(0x2a0806)
  expect(hasPanel(76, 7, 5)).toBe(true)
  expect(hasPanel(75, 8, 5)).toBe(false)
  expect(hasPanel(76, 6, 5)).toBe(false)
  expect(hasPanel(76, 8, 1000)).toBe(false)
  expect(hasPanel(76, 8, 999.994)).toBe(true)
  expect(hasPanel(76, 8, 999.996)).toBe(false)
  for (const usd of [999.99, 999.995, 999.999]) expect(hasPanel(76, 8, usd)).toBe(meterFits(76, 8, usd))
  // A fare still above a fallen target paints the target, not 000.50.
  const painted = (fare: number) => Array.from(paintScene({ ...newScene(), fare, fareTo: 3 }, IDLE, 76)).join()
  expect(painted(1000.5)).toBe(painted(3))
})

test('the panel draws its frame, digits and point as the preview does, leading zeros left out', () => {
  const litCols = (fareTo: number) => {
    const p = paintScene({ ...newScene(), fareTo }, DRIVE, 76)
    const mx = 76 - 28
    expect(p[2 * 76 + mx]).toBe(0x5a5f70)
    expect(p[10 * 76 + mx + 25]).toBe(0x5a5f70)
    expect(p[3 * 76 + mx + 1]).toBe(0x2a0806)
    const lit = (off: number) => {
      for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (p[(4 + j) * 76 + mx + 2 + off + i] === 0xff4d3d) return true
      return false
    }
    return [0, 4, 8, 14, 18].map(lit)
  }
  expect(litCols(1.23)).toEqual([false, false, true, true, true])
  expect(litCols(12.34)).toEqual([false, true, true, true, true])
  expect(litCols(100)).toEqual([true, true, true, true, true])

  // '0' is hollow in its middle, '8' is not.
  const p = paintScene({ ...newScene(), fareTo: 8 }, DRIVE, 76)
  const center = (off: number) => p[6 * 76 + 48 + 2 + off + 1]
  expect(center(8)).toBe(0xff4d3d)
  expect(center(14)).toBe(0x2a0806)
})

test('the LED: red while driving, yellow at arrival, dim otherwise, and never blinks', () => {
  const led = (x: Parameters<typeof paintScene>[1], t = 0) => paintScene({ ...newScene(), t }, x, 76)[LED_POINT(76)]
  const RED = 0xff4d3d
  const YELLOW = 0xffd84a
  const DIM = 0x7a241c
  expect(led(DRIVE)).toBe(RED)
  expect(led({ ...ARRIVE, agents: 1 })).toBe(RED)
  expect(led({ ...IDLE, agents: 1 })).toBe(RED)
  expect(led(ARRIVE)).toBe(YELLOW)
  expect(led(IDLE)).toBe(DIM)
  expect(led({ ...IDLE, bg: 2 })).toBe(DIM)
  for (let t = 0; t < 64; t += 8) expect(led({ ...IDLE, bg: 2 }, t)).toBe(DIM)
})

test('the fare rolls up to its target, snapping on the first draw and on a drop', () => {
  const s = newScene()
  s.fareTo = 12.34
  expect(isMoving(s, IDLE)).toBe(false) // nothing to roll before the first step snaps it
  stepScene(s, IDLE, 76)
  expect(s.fare).toBe(12.34)
  expect(isMoving(s, IDLE)).toBe(false)

  s.fareTo = 12.9
  expect(isMoving(s, IDLE)).toBe(true) // parked, and on the fast timer while it rolls
  const seen: number[] = []
  for (let i = 0; i < 200 && s.fare !== s.fareTo; i++) {
    stepScene(s, IDLE, 76)
    seen.push(s.fare ?? 0)
  }
  expect(seen.length).toBeGreaterThan(5)
  expect(seen.length).toBeLessThan(200)
  expect(seen.every((v, i) => v > (seen[i - 1] ?? 12.34))).toBe(true)
  expect(s.fare).toBe(12.9)
  expect(isMoving(s, IDLE)).toBe(false)

  s.fareTo = 3
  stepScene(s, IDLE, 76)
  expect(s.fare).toBe(3)

  // The panel paints the rolling figure, not the target.
  // The ones digit's top-left pixel: dark in '1', lit in '2'.
  const topLeft = (fare: number) => paintScene({ ...newScene(), fare, fareTo: 2 }, DRIVE, 76)[4 * 76 + 48 + 2 + 8]
  expect(topLeft(1)).toBe(0x2a0806)
  expect(topLeft(2)).toBe(0xff4d3d)
})

test('the slow timer also rolls: a redraw with a higher fare moves to the fast one', async ($, on) => {
  const clock = mock.clock(on, { now: NOV_4 })
  engine(on)
  const blit = blitter(on)
  await start($)
  await $.session.measure(cost(1))
  const ui = await $.ui.mount(BAND)
  await clock.advance(667 * 3)
  const parked = blit.count
  await clock.advance(667)
  expect(blit.count - parked).toBe(1) // settled, on the slow timer

  await $.session.measure(cost(2))
  await ui.drawn()
  const atRise = blit.count
  await clock.advance(830)
  expect(blit.count - atRise).toBe(10)
  await ui.unmount()
})

test('the flag and the gas station stand left of the panel', () => {
  const inSpan = (p: Uint32Array, colors: number[], from: number, to: number) => {
    let hit = false
    for (let y = 0; y < 14; y++) {
      for (let c = 0; c < 76; c++) {
        if (!colors.includes(p[y * 76 + c] ?? 0)) continue
        if (c >= 39 && c <= 47) hit = true
        if (c >= from && c <= to) return 'on the panel'
      }
    }
    return hit
  }
  const stopped = { ...newScene(), fareTo: 1 }
  expect(inSpan(paintScene(stopped, ARRIVE, 76), [0xc9ccd6], 48, 75)).toBe(true)
  expect(inSpan(paintScene(stopped, { ...IDLE, gas: true }, 76), [0xe8483f], 48, 75)).toBe(true)
  // The flag's cloth and the station's right post stop at the column before the panel.
  const flag = paintScene(stopped, ARRIVE, 76)
  expect(flag[2 * 76 + 40]).toBe(0xc9ccd6)
  expect(flag[2 * 76 + 47]).not.toBe(0xf4f4f4)
  expect(flag[2 * 76 + 48]).toBe(0x5a5f70)
  const gas = paintScene(stopped, { ...IDLE, gas: true }, 76)
  expect(gas[13 * 76 + 39]).toBe(0xe8483f)
  expect(gas[13 * 76 + 47]).toBe(0xe8483f)
  // Without the panel they keep their places.
  expect(paintScene(newScene(), ARRIVE, 72)[2 * 72 + 49]).toBe(0xc9ccd6)
  expect(paintScene(newScene(), { ...IDLE, gas: true }, 72)[13 * 72 + 52]).toBe(0xe8483f)
})

test('no sky between a wheel and the body, at every bump position, big and small', () => {
  const WHEELS = [0x5a5f70, 0xc9ccd6]
  const BODY = [0xffc92e, 0xd99a14, 0x1b1d24, 0x8fd3ff, 0x5aa6d6, 0xf4f4f4, 0xff4d3d, 0xfff3a8]
  const check = (rows: number, wheels: number[]) => {
    const ground = rows * 2 - 2
    for (let scroll = 0; scroll < 2; scroll++) {
      for (let bx = 60; bx >= -9; bx--) {
        const s = { ...newScene(), scroll, bump: { x: bx, hit: true } }
        const p = paintScene(s, DRIVE, 72, rows)
        for (const c of wheels) {
          let top = 0
          while (top < ground && !WHEELS.includes(p[top * 72 + c] ?? 0)) top++
          expect(top).toBeLessThan(ground)
          const bodyAbove = Array.from({ length: top }, (_, y) => p[y * 72 + c] ?? 0).some(v => BODY.includes(v))
          if (bodyAbove && !BODY.includes(p[(top - 1) * 72 + c] ?? 0)) throw new Error(`gap: rows ${rows} scroll ${scroll} bump ${bx} col ${c}`)
        }
      }
    }
  }
  check(8, [CAR_X + 5, CAR_X + 6, CAR_X + 7, CAR_X + 17, CAR_X + 18, CAR_X + 19])
  check(7, [CAR_X + 5, CAR_X + 6, CAR_X + 7, CAR_X + 17, CAR_X + 18, CAR_X + 19])
  const smallCar = CAR_X + 8
  for (const rows of [6, 5, 4]) check(rows, [2, 3, 4, 9, 10, 11].map(c => smallCar + c))

  // With no sky to lift into, a wheel climbs one row into the body, not two.
  let climbed = false
  for (let bx = 60; bx >= -9; bx--) {
    const p = paintScene({ ...newScene(), bump: { x: bx, hit: true } }, DRIVE, 72, 4)
    expect(WHEELS).not.toContain(p[2 * 72 + smallCar + 10])
    climbed ||= WHEELS.includes(p[3 * 72 + smallCar + 10] ?? 0)
  }
  expect(climbed).toBe(true)
})

test('the frame is one half-block cell per column and row, at any width', () => {
  for (const width of [24, 40, 72, 130]) {
    const cells = taxiFrame(newScene(), IDLE, width)
    expect(cells.length).toBe(Math.ceil((width * 8 * 12) / 3) * 4)
  }
})

const blitter = (on: On) => {
  const state = { count: 0, deny: undefined as string | undefined, sites: new Set<string>() }
  on('ui.blit', (_, e) => {
    state.count++
    state.sites.add(e.requestId)
    return { value: state.deny ? { deny: state.deny } : {} }
  })
  return state
}

test('the band mounts a Raster on the terminal, a still Svg elsewhere, and blits its own instance', async ($, on) => {
  const clock = mock.clock(on, { now: NOV_4 })
  engine(on)
  const blit = blitter(on)

  await start($)
  await $.session.measure(cost(1))

  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await desktop.find({ type: 'Text', text: /^이번 운행/ })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: /오늘 \$1\.00/ })).toBeDefined()
  expect(await desktop.find({ type: 'Raster' })).toBeUndefined()
  const still = await desktop.find({ type: 'Svg' })
  expect(still?.props.source).toContain('<svg')
  expect((still?.props.source as string).length).toBeLessThan(131072)
  await desktop.unmount()
  await clock.advance(2000)
  expect(blit.count).toBe(0)

  const ui = await $.ui.mount({ ...BAND, requestId: 'band-1' })
  const road = await ui.find({ type: 'Raster', key: 'road' })
  expect(road).toBeDefined()
  expect((await ui.drawn()).type).toBe('Box')
  expect(await ui.find({ type: 'Text', text: /세션 계기판/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^연료/ })).toBeDefined()

  await clock.advance(5000)
  expect(blit.count).toBeGreaterThan(0)
  expect([...blit.sites]).toEqual(['band-1'])

  // A deny ends the timer; the retries are bounded, so the clock runs on with no more blits.
  blit.deny = 'not mounted'
  await clock.advance(1000)
  await clock.advance(10_000)
  const atDeny = blit.count
  await clock.advance(5000)
  expect(blit.count).toBe(atDeny)
  await ui.unmount()
})

test('the Raster is laid out to the box, inside its border and padding', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  engine(on)
  blitter(on)
  await start($)
  await $.session.measure(cost(1))
  const ui = await $.ui.mount(BAND)
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('"columns":76')
  expect(drawn).toContain('"rows":7')
  await ui.unmount()
})

test('a very wide terminal keeps the Raster inside its 512-column limit', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  engine(on)
  blitter(on)
  await start($)
  await $.session.measure(cost(1))
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 600 } })
  expect(JSON.stringify(await ui.drawn())).toContain('"columns":512')
  await ui.unmount()
})

test("a desktop drawing does not stop the terminal's taxi", async ($, on) => {
  const clock = mock.clock(on, { now: NOV_4 })
  engine(on)
  const blit = blitter(on)
  await start($)
  await $.session.measure(cost(1))

  const ui = await $.ui.mount({ ...BAND, requestId: 'band-1' })
  await clock.advance(2000)
  const before = blit.count
  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await clock.advance(5000)
  expect(blit.count).toBeGreaterThan(before)
  await desktop.unmount()
  await ui.unmount()
})

test('a band too short or too narrow for the whole box draws text and no timer', async ($, on) => {
  const clock = mock.clock(on, { now: NOV_4 })
  engine(on)
  const blit = blitter(on)
  await start($)
  await $.session.measure(cost(1))

  // 3 text rows leave 3 rows, border gone: less than the car and its road.
  const tooShort = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 6 } })
  expect(await tooShort.find({ type: 'Raster' })).toBeUndefined()
  expect(await tooShort.find({ type: 'Text', text: /^요금/ })).toBeDefined()
  await tooShort.unmount()

  const tooNarrow = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 17 } })
  expect(await tooNarrow.find({ type: 'Raster' })).toBeUndefined()
  await tooNarrow.unmount()

  await clock.advance(2000)
  expect(blit.count).toBe(0)

  const fits = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 14 } })
  expect(await fits.find({ type: 'Raster' })).toBeDefined()
  await fits.unmount()
})

test('taxiFits counts the rows the text wraps to, Hangul at two cells', () => {
  const rows = bandRows(
    { limits: [], now: NOV_4, usd: 1, ctxPct: 10 },
    { others: {}, backfill: {} },
    { id: SID, lastCost: 0, days: {} },
    { mode: 'idle', gas: false, tripStart: 0, since: 0, bg: 0, agents: 0 },
    '2026-11-04',
  )
  const fit = (width: number, max: number) => taxiLayout(rows, width, max)
  expect(fit(80, 40)).toEqual({ rows: 7, border: true }) // the cap: 12 rows with text and border
  // One row at a time: the sky, then the border gives five back.
  expect(fit(80, 12)).toEqual({ rows: 7, border: true })
  expect(fit(80, 11)).toEqual({ rows: 6, border: true })
  expect(fit(80, 10)).toEqual({ rows: 5, border: true })
  expect(fit(80, 9)).toEqual({ rows: 4, border: true })
  expect(fit(80, 8)).toEqual({ rows: 5, border: false })
  expect(fit(80, 7)).toEqual({ rows: 4, border: false })
  expect(fit(80, 6)).toBeUndefined()
  // At 28 cells the fare row (35 cells) and the totals row (42) take two rows each.
  expect(fit(32, 11)).toEqual({ rows: 4, border: true })
  expect(fit(32, 9)).toEqual({ rows: 4, border: false })
  expect(fit(32, 8)).toBeUndefined()
  expect(fit(17, 40)).toBeUndefined()
})

test('a half-height band draws and blits the small car in the rows it was given', async ($, on) => {
  const clock = mock.clock(on, { now: NOV_4 })
  engine(on)
  const sizes = new Set<number>()
  on('ui.blit', (_, e) => {
    sizes.add((e as unknown as { cells: string }).cells.length)
    return { value: {} }
  })
  await start($)
  await $.session.measure(cost(1))
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 10 } })
  expect(JSON.stringify(await ui.drawn())).toContain('"rows":5')
  expect(await ui.find({ type: 'Text', text: /세션 계기판/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^요금/ })).toBeDefined()
  await clock.advance(2000)
  expect([...sizes]).toEqual([Math.ceil((76 * 5 * 12) / 3) * 4])
  await ui.unmount()
})

test('the skyline keeps its ups and downs at every height, lower as the band shrinks', () => {
  const skyline = (rows: number) => {
    const p = paintScene(newScene(), IDLE, 200, rows)
    const ground = rows * 2 - 2
    const built = new Set([0x1a2238, 0xd9b75c])
    const heights = new Set<number>()
    for (let c = 40; c < 200; c++) {
      let n = 0
      while (n < ground && built.has(p[(ground - 1 - n) * 200 + c] ?? 0)) n++
      if (n > 0) heights.add(n)
    }
    return heights
  }
  let tallest = 99
  for (const rows of [8, 7, 6, 5, 4]) {
    const heights = skyline(rows)
    expect(heights.size).toBeGreaterThanOrEqual(3)
    expect(Math.max(...heights)).toBeLessThan(tallest)
    tallest = Math.max(...heights)
  }
  expect(Math.max(...skyline(8))).toBe(11) // the full scene is unchanged
})

test('the big car needs its rows and columns; the small car stays whole, and lifts where there is sky', () => {
  const top = (rows: number, s = newScene(), width = 72) => {
    const p = paintScene(s, DRIVE, width, rows)
    expect(p.length).toBe(width * rows * 2)
    for (let y = 0; y < rows * 2; y++) for (let c = 0; c < width; c++) if (p[y * width + c] === ROOF) return y
    return -1
  }
  expect(top(8)).toBe(16 - 2 - 11 + 2) // the big car's roof
  expect(top(7)).toBe(14 - 2 - 11 + 2)
  expect(top(6)).toBe(12 - 2 - 6 + 1) // the small car's
  expect(top(5)).toBe(10 - 2 - 6 + 1)
  expect(top(4)).toBe(8 - 2 - 6 + 1)
  expect(top(8, newScene(), 20)).toBe(16 - 2 - 6 + 1) // too narrow for the big one
  // The small car's front wheel, at column 32, on the bump's top row.
  const bumped = () => ({ ...newScene(), bump: { x: 29, hit: true } })
  expect(top(8, bumped())).toBe(4) // the big car, lifted one too
  expect(top(5, bumped())).toBe(2) // one pixel up
  expect(top(4, bumped())).toBe(1) // no sky: it stays on the road
  // Lifted, the rear wheel on the road still meets the body's bottom row.
  const p = paintScene(bumped(), DRIVE, 72, 5)
  expect(p[5 * 72 + 25]).toBe(0x1b1d24)
  expect([0x5a5f70, 0xc9ccd6]).toContain(p[6 * 72 + 25])
})

test('a survey yields to the engine and stops the timer', async ($, on) => {
  const clock = mock.clock(on, { now: NOV_4 })
  engine(on)
  const blit = blitter(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await start($)
  await $.session.measure(cost(1))

  const ui = await $.ui.mount(BAND)
  await clock.advance(1000)
  expect(blit.count).toBeGreaterThan(0)
  await ui.unmount()

  const survey = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(await survey.find({ type: 'Text', text: /engine/ })).toBeDefined()
  const atSurvey = blit.count
  await clock.advance(5000)
  expect(blit.count).toBe(atSurvey)
  await survey.unmount()
})

test('a second drawing does not start a second timer', async ($, on) => {
  const clock = mock.clock(on, { now: NOV_4 })
  engine(on)
  const blit = blitter(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))

  await start($)
  await $.session.measure(cost(1))
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const ui = await $.ui.mount(BAND)
  await $.session.measure(cost(2)) // redraws the band
  await $.session.measure(cost(3))
  await ui.drawn()
  await clock.advance(830)
  expect(blit.count).toBe(10) // 83 ms a frame, one timer
  await ui.unmount()
})

test('an old frame denied in flight does not end the timer that replaced it', async ($, on) => {
  const clock = mock.clock(on, { now: NOV_4 })
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  let blits = 0
  let ui: any
  // The slow timer's frame goes out; while it is in flight a turn starts, the fast timer replaces
  // it, and only then does the old frame's blit come back denied.
  on('ui.blit', async () => {
    if (++blits > 1) return { value: {} }
    await $.turn.start({ text: 'hi', turnId: 't1' })
    await ui.drawn()
    return { value: { deny: 'not mounted' } }
  })

  await start($)
  await $.session.measure(cost(1))
  ui = await $.ui.mount(BAND)
  await clock.advance(667)
  expect(blits).toBeGreaterThan(0)

  const before = blits
  await clock.advance(830)
  expect(blits).toBeGreaterThan(before + 5)
  await ui.unmount()
})

test('a first blit denied before the mount asks for a redraw, and the redraw restarts it', async ($, on) => {
  const clock = mock.clock(on, { now: NOV_4 })
  const world = engine(on)
  const blit = blitter(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))

  await start($)
  await $.session.measure(cost(1))
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const invalidatedAtStart = world.invalidated
  blit.deny = 'not mounted'
  const ui = await $.ui.mount(BAND)
  await clock.advance(83)
  expect(blit.count).toBe(1)

  await clock.advance(600)
  expect(blit.count).toBe(1) // stopped, waiting for the drawing
  expect(world.invalidated).toBe(invalidatedAtStart + 1)

  // The engine answers the invalidate with a drawing; now mounted, the frames run.
  blit.deny = undefined
  await $.session.measure(cost(2))
  await ui.drawn()
  await clock.advance(830)
  expect(blit.count).toBeGreaterThan(5)
  await ui.unmount()
})

test('a turn start restarts a timer a deny stopped', async ($, on) => {
  const clock = mock.clock(on, { now: NOV_4 })
  engine(on)
  const blit = blitter(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  await start($)
  await $.session.measure(cost(1))
  blit.deny = 'not mounted'
  const ui = await $.ui.mount(BAND)
  await clock.advance(20_000) // stopped for good, retries spent
  blit.deny = undefined
  const before = blit.count
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await ui.drawn()
  await clock.advance(830)
  expect(blit.count).toBeGreaterThan(before + 5)
  await ui.unmount()
})

const status = async ($: any) => bandRow($, /^이번 운행/, 'desktop') as Promise<string>

test('turns move the taxi: driving, a subagent changes nothing, arrival, then for hire', async ($, on) => {
  const clock = mock.clock(on, { now: NOV_4 })
  const world = engine(on, {}, { id: SID, usd: 1 })
  blitter(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  await start($)
  expect(await status($)).toContain('빈차')

  await $.turn.start({ text: 'hi', turnId: 't1' })
  expect(await status($)).toContain('주행 중')

  await $.turn.complete({ text: '', turnId: 't1', reason: 'answer', agentId: 'sub' } as any)
  expect(await status($)).toContain('주행 중')

  world.usd = 1.5
  await $.session.measure(cost(1.5))
  await $.turn.complete({ text: '', turnId: 't1', reason: 'answer' } as any)
  const arrived = await status($)
  expect(arrived).toContain('도착')
  expect(arrived).toContain('이번 운행 $0.50')

  await clock.advance(31_000)
  expect(await status($)).toContain('빈차')
})

test('classic.Stop counts background work; the band shows it except while driving', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  engine(on, {}, { id: SID, usd: 1 })
  blitter(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  const task = (id: string) => ({ id, type: 'shell', status: 'running', description: id })
  const stop = (ids: string[], agent_id?: string) =>
    $.classic.Stop({ stop_hook_active: false, background_tasks: ids.map(task), agent_id })

  await start($)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await stop(['a', 'b'])
  expect(await status($)).toContain('주행 중')
  await $.turn.complete({ text: '', turnId: 't1', reason: 'answer' } as any)
  expect(await status($)).toContain('백그라운드 2개')

  await stop([], 'sub') // a subagent's stop says nothing of the main turn's count
  expect(await status($)).toContain('백그라운드 2개')

  await $.turn.start({ text: 'hi', turnId: 't2' }) // keeps the count, though the label drives
  expect(await status($)).not.toContain('백그라운드')
  await $.turn.complete({ text: '', turnId: 't2', reason: 'answer' } as any)
  expect(await status($)).toContain('백그라운드 2개')

  await stop([])
  expect(await status($)).toContain('도착')

  await stop(['a'])
  await $.classic.SessionStart({ source: 'clear', session_id: 'sess-b' })
  expect(await status($)).toContain('빈차')

  for (const reason of ['aborted', 'error', 'refusal']) {
    await stop(['a'])
    await $.turn.start({ text: 'hi', turnId: 't3' })
    await $.turn.complete({ text: '', turnId: 't3', reason } as any) // no Stop follows these
    expect(await status($)).toContain('도착')
  }

  for (const source of ['resume', 'fork'] as const) {
    await stop(['a'])
    expect(await status($)).toContain('백그라운드 1개')
    await $.classic.SessionStart({ source, session_id: 'sess-b' })
    expect(await status($)).not.toContain('백그라운드')
  }
})

test('agents split from shell work at Stop and every clearing path clears them', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  engine(on, {}, { id: SID, usd: 1 })
  blitter(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  const stop = (...types: string[]) =>
    $.classic.Stop({
      stop_hook_active: false,
      background_tasks: types.map((type, i) => ({ id: `${i}`, type, status: 'running', description: type })),
    })
  const end = (reason: string) => $.turn.complete({ text: '', turnId: 't', reason } as any)

  await start($)
  await $.turn.start({ text: 'hi', turnId: 't' })
  await stop('subagent', 'workflow', 'shell')
  expect(await status($)).toContain('주행 중') // the main turn's own label comes first
  await end('answer')
  expect(await status($)).toContain('서브에이전트 2개 · 백그라운드 1개')

  await stop('subagent')
  expect(await status($)).toContain('서브에이전트 1개')
  expect(await status($)).not.toContain('백그라운드')

  await stop('shell') // shell work alone stays parked, with its lamp
  expect(await status($)).toContain('백그라운드 1개')
  expect(await status($)).not.toContain('서브에이전트')
  const shellOnly = { mode: 'arrive', gas: false, bg: 1, agents: 0 } as const
  expect(isMoving(newScene(), shellOnly)).toBe(false)

  await stop('subagent')
  await end('aborted')
  expect(await status($)).not.toContain('서브에이전트')

  await stop('subagent')
  await end('answer') // an answer keeps the count
  expect(await status($)).toContain('서브에이전트 1개')

  for (const source of ['resume', 'fork'] as const) {
    await stop('subagent')
    await $.classic.SessionStart({ source, session_id: SID })
    expect(await status($)).not.toContain('서브에이전트')
  }

  await stop('subagent')
  await $.classic.SessionStart({ source: 'clear', session_id: 'sess-b' })
  expect(await status($)).toContain('빈차')
})

test('the fare leaves the text while the panel draws it, on the desktop too, and stays where it does not', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  engine(on)
  blitter(on)
  await start($)
  await $.session.measure(cost(1.5))

  const fareRow = async (bodyColumns: number, surface: 'terminal' | 'desktop' = 'terminal', usd?: number) => {
    if (usd !== undefined) await $.session.measure(cost(usd))
    const ui = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, bodyColumns } })
    const fare = await ui.find({ type: 'Text', text: /^요금/ })
    const trip = await ui.find({ type: 'Text', text: /^이번 운행/ })
    await ui.unmount()
    return { fare: fare?.text as string | undefined, trip: trip?.text as string | undefined }
  }
  const wide = await fareRow(80)
  expect(wide.fare).toBeUndefined()
  expect(wide.trip).toContain('이번 운행 $1.50')

  expect((await fareRow(79)).fare).toContain('요금 $1.50') // 75 columns of road
  expect((await fareRow(80, 'desktop')).fare).toBeUndefined()
  expect((await fareRow(79, 'desktop')).fare).toContain('요금 $1.50')
  expect((await fareRow(80, 'terminal', 1000)).fare).toContain('요금 $1000.00')
  await $.session.measure(cost(1.5))

  const short = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 10 } }) // 5 rows of road
  expect(await short.find({ type: 'Text', text: /^요금/ })).toBeDefined()
  await short.unmount()
})

const BAND_ROWS = (over: Partial<Parameters<typeof bandRows>[0]>, panel = false) =>
  bandRows(
    { limits: [], now: NOV_4, usd: 1, ctxPct: 10, ...over },
    { others: {}, backfill: {} },
    { id: SID, lastCost: 0, days: {} },
    { mode: 'idle', gas: false, tripStart: 0, since: 0, bg: 0, agents: 0 },
    '2026-11-04',
    panel,
  )
const segment = (rows: ReturnType<typeof bandRows>, text: RegExp) => rows.flat().find(seg => text.test(seg.text))

const DAY_7 = (percentUsed: number, resetsAt?: string) => ({ kind: 'seven_day', percentUsed, resetsAt })
const FRIDAY_9 = new Date(2026, 10, 6, 9, 0).toISOString()

test('the cache is on the first row whenever known, in three colours, and not on the fuel row', () => {
  const rows = (minutesAgo: number) => BAND_ROWS({ lastAt: NOV_4 - minutesAgo * 60_000 })
  const cache = (minutesAgo: number) => segment(rows(minutesAgo), /캐시/)
  expect(segment(BAND_ROWS({}), /캐시/)).toBeUndefined()
  expect(cache(0)?.text).toBe('   캐시 60분')
  expect(cache(0)?.color).toBeUndefined()
  expect(cache(49)?.text).toBe('   캐시 11분')
  expect(cache(49)?.color).toBeUndefined()
  expect(cache(50)?.text).toBe('   캐시 10분')
  expect(cache(50)?.color).toBe('#f0c040')
  expect(cache(59)?.text).toBe('   캐시 1분')
  expect(cache(59)?.color).toBe('#f0c040')
  expect(cache(60)?.text).toBe('   캐시 만료')
  expect(cache(60)?.color).toBe('#ff6b5e')
  for (const minutesAgo of [0, 50, 60]) {
    expect(rows(minutesAgo)[0]?.some(seg => /캐시/.test(seg.text))).toBe(true)
    expect(rows(minutesAgo)[1]?.some(seg => /캐시/.test(seg.text))).toBe(false)
  }
})

test('the first row runs trip, status, elapsed, cache; the fare leads it only without the panel', () => {
  const over = { startedAt: NOV_4 - 12 * 60_000, lastAt: NOV_4 - 12 * 60_000 }
  const row = (panel: boolean) => BAND_ROWS(over, panel)[0]?.map(seg => seg.text).join('')
  expect(row(true)).toBe('이번 운행 $1.00   빈차   운행 12분   캐시 48분')
  expect(row(false)).toBe('요금 $1.00   이번 운행 $1.00   빈차   운행 12분   캐시 48분')
  // The layout counts the whole 59-cell row: at 59 cells of box it stays one row, at 58 it wraps to two.
  expect(taxiLayout(BAND_ROWS(over), 59 + 4, 9)).toEqual({ rows: 4, border: true })
  expect(taxiLayout(BAND_ROWS(over), 58 + 4, 9)).toEqual({ rows: 5, border: false })
})

test('elapsed reads in minutes under an hour, then hours and minutes, and is left out when unknown', () => {
  const shown = (minutes: number) => segment(BAND_ROWS({ startedAt: NOV_4 - minutes * 60_000 }), /운행 \d/)?.text
  expect(segment(BAND_ROWS({}), /운행 \d/)).toBeUndefined()
  expect(shown(0)).toBe('   운행 0분')
  expect(shown(59)).toBe('   운행 59분')
  expect(shown(60)).toBe('   운행 1시간 0분')
  expect(shown(72)).toBe('   운행 1시간 12분')
})

test('elapsed comes from usage, advances with the minute tick and restarts after /clear', async ($, on) => {
  const clock = mock.clock(on, { now: NOV_4 })
  const world = engine(on)
  world.startedAt = NOV_4 - 59 * 60_000
  await start($)
  await $.session.measure(cost(1))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const shown = async () => (await ui.find({ type: 'Text', text: /^이번 운행/ }))?.text as string
  expect(await shown()).toContain('운행 59분')
  await clock.advance(60_000)
  await ui.drawn()
  expect(await shown()).toContain('운행 1시간 0분')
  await clock.advance(12 * 60_000)
  await ui.drawn()
  expect(await shown()).toContain('운행 1시간 12분')
  await ui.unmount()

  world.startedAt = NOV_4 + 13 * 60_000
  await $.session.end({ reason: 'clear', sessionId: SID, resume: { id: SID } } as any)
  world.id = 'sess-b'
  world.usd = 0
  await $.classic.SessionStart({ source: 'clear', session_id: 'sess-b' })
  await $.session.measure(cost(0.25))
  expect(await bandRow($, /^이번 운행/, 'desktop')).toContain('운행 0분')
})

test('the band shows the 7-day limit alone, its reset after it; /meter keeps every window', async ($, on) => {
  const row = (limits: Parameters<typeof BAND_ROWS>[0]['limits']) => BAND_ROWS({ limits })[1]?.map(seg => seg.text).join('')
  const fuel = '연료 █████████░ 90%'
  expect(row([{ kind: 'five_hour', percentUsed: 41 }])).toBe(fuel)
  expect(row([{ kind: 'spend_limit', percentUsed: 41 }])).toBe(fuel)
  expect(row([{ kind: 'five_hour', percentUsed: 41 }, DAY_7(60)])).toBe(`${fuel}   7일 ██████░░░░ 60%`)
  expect(row([DAY_7(60, FRIDAY_9)])).toBe(`${fuel}   7일 ██████░░░░ 60% (리셋 금 09:00)`)

  mock.clock(on, { now: NOV_4 })
  engine(on)
  await start($)
  await $.session.measure({ ...cost(1), rateLimits: [{ kind: 'five_hour', percentUsed: 41 }, DAY_7(60, FRIDAY_9)] })
  const band = await bandRow($, /^연료/, 'desktop')
  expect(band).toContain('7일 ██████░░░░ 60% (리셋 금 09:00)')
  expect(band).not.toContain('5시간')
  const report = (await run($)).text as string
  expect(report).toContain('5시간 ████░░░░░░ 41%')
  expect(report).toContain('7일 ██████░░░░ 60% (리셋 09:00)')
})

test('the limit colours by its own use, the fuel bar and low-fuel label by what is left, the totals dim', () => {
  const limit = (percentUsed: number) => segment(BAND_ROWS({ limits: [DAY_7(percentUsed)] }), /7일/)?.color
  expect(limit(79)).toBeUndefined()
  expect(limit(80)).toBe('#f0c040')
  expect(limit(94)).toBe('#f0c040')
  expect(limit(95)).toBe('#ff6b5e')

  const fuel = (ctxPct: number) => segment(BAND_ROWS({ ctxPct }), /[█░]{10}/)?.color
  expect(fuel(90)).toBe('#ff6b5e') // 10 left
  expect(fuel(89)).toBe('#f0c040') // 11
  expect(fuel(51)).toBe('#f0c040') // 49
  expect(fuel(50)).toBe('#5fd38a')

  const label = (ctxPct: number) =>
    bandRows(
      { limits: [], now: NOV_4, usd: 1, ctxPct },
      { others: {}, backfill: {} },
      { id: SID, lastCost: 0, days: {} },
      { mode: 'drive', gas: false, tripStart: 0, since: 0, bg: 0, agents: 0 },
      '2026-11-04',
    )[0]?.at(-1)?.text
  expect(label(90)).toBe('연료 부족')
  expect(label(89)).toBe('주행 중')

  expect(segment(BAND_ROWS({}), /^오늘 /)?.dim).toBe(true)
  expect(BAND_ROWS({}, true)[0]?.[0]?.text).toMatch(/^이번 운행/)
  expect(BAND_ROWS({})[0]?.[0]?.text).toBe('요금 ')
})

test('compaction stops at the gas station, then refuels', async ($, on) => {
  const clock = mock.clock(on, { now: NOV_4 })
  engine(on)
  let during = ''
  on('session.compact', async (_, e) => {
    during = await status($)
    return { messages: e.messages }
  })

  await start($)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'x', toolUses: [] }] } as any)
  expect(during).toContain('주유 중')
  expect(await status($)).toContain('주유 중')
  await clock.advance(1500)
  expect(await status($)).not.toContain('주유 중')
})

test('fuel is what the context leaves', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  engine(on)
  await start($)
  await $.session.measure({ ...cost(1), context: { window: 200_000, tokens: 164_000, percent: 82 } })
  expect(await bandRow($, /^연료/, 'desktop')).toContain(' 18%')
})

test('no pane opens, and the one 0.2.0 left up is closed', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  const world = engine(on)
  // `ui.open` has no answer here: opening one would fail this test.
  await start($)
  expect(world.closed).toEqual(['session-taxi'])
})

test('/taxi turns the whole band off and on, kept in the store, with no timer while off', async ($, on) => {
  const clock = mock.clock(on, { now: NOV_4 })
  const world = engine(on)
  const blit = blitter(on)
  await start($)
  await $.session.measure(cost(1))

  expect((await run($, '', 'taxi')).text).toContain('택시 계기판을 껐어요.')
  expect(world.store.taxiOn).toBe(false)
  for (const surface of ['terminal', 'desktop'] as const) {
    const off = await $.ui.mount({ ...BAND, surface })
    expect(await off.find({ type: 'Raster' })).toBeUndefined()
    expect(await off.find({ type: 'Text', text: /^연료/ })).toBeUndefined()
    await off.unmount()
  }
  await clock.advance(5000)
  expect(blit.count).toBe(0)

  expect((await run($, '', 'taxi')).text).toBe('택시 계기판을 켰어요.')
  expect(world.store.taxiOn).toBe(true)
  const up = await $.ui.mount(BAND)
  expect(await up.find({ type: 'Raster' })).toBeDefined()
  expect(await up.find({ type: 'Text', text: /^연료/ })).toBeDefined()
  await up.unmount()
})

test('a stored /taxi off holds in a new session', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  engine(on, { taxiOn: false })
  await start($)
  await $.session.measure(cost(1))
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

test('/clear reads the stored /taxi choice again, as its atoms start over', async ($, on) => {
  mock.clock(on, { now: NOV_4 })
  const world = engine(on)
  await start($)
  await $.session.measure(cost(1))
  world.store.taxiOn = false
  await $.classic.SessionStart({ source: 'clear', session_id: 'sess-b' })
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

test('retries after a deny are bounded, however many redraws follow', async ($, on) => {
  const clock = mock.clock(on, { now: NOV_4 })
  const world = engine(on)
  const blit = blitter(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await start($)
  await $.session.measure(cost(1))
  await $.turn.start({ text: 'hi', turnId: 't1' })
  blit.deny = 'never mounted'
  const ui = await $.ui.mount(BAND)
  const atStart = world.invalidated
  for (let round = 0; round < 8; round++) {
    await clock.advance(600)
    await $.session.measure(cost(2 + round)) // stands for the redraw the invalidate asks for
    await ui.drawn()
  }
  expect(world.invalidated - atStart).toBe(3)
  await ui.unmount()
})

test('falling back to text stops a running timer', async ($, on) => {
  const clock = mock.clock(on, { now: NOV_4 })
  engine(on)
  const blit = blitter(on)
  await start($)
  await $.session.measure(cost(1))
  const full = await $.ui.mount(BAND)
  await clock.advance(1000)
  expect(blit.count).toBeGreaterThan(0)
  await full.unmount()

  const short = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 5 } })
  const atFallback = blit.count
  await clock.advance(5000)
  expect(blit.count).toBe(atFallback)
  await short.unmount()
})

test('the lane dashes sit on the last road row, inside the frame', () => {
  const p = paintScene(newScene(), IDLE, 72)
  expect(p.length).toBe(72 * 16)
  expect(p[15 * 72]).toBe(0xd9dbe4)
  expect(p[15 * 72 + 4]).toBe(0x1c2030)
  expect(p[14 * 72]).toBe(0x3b4158) // the kerb
})

test('rows wrap by word, as the terminal does, and a fare jump rolls within about two seconds', () => {
  expect(wrappedRows('운행 시간', 9)).toBe(1)
  expect(wrappedRows('운행 시간', 8)).toBe(2)
  expect(wrappedRows('가나다라 마바사아 자차카타', 18)).toBe(2) // 26 cells: dividing says 2, and words fit 2
  expect(wrappedRows('가나다라 마바사아 자차카타', 13)).toBe(3) // dividing says 2; no two words fit a row
  expect(wrappedRows('abcdefghij', 4)).toBe(3)

  const s = newScene()
  stepScene(s, IDLE, 72)
  s.fareTo = 5
  let frames = 0
  while (s.fare !== s.fareTo && frames < 100) {
    stepScene(s, IDLE, 72)
    frames++
  }
  expect(s.fare).toBe(5)
  expect(frames).toBeLessThanOrEqual(30) // 12 frames a second
})

test('the desktop taxi animates what the terminal runs on a timer, and fits the Svg limit', () => {
  const parked = { mode: 'idle', gas: false, bg: 0, agents: 0 } as const
  const driving = { ...parked, mode: 'drive' } as const
  expect(isTaxiAnimated(parked)).toBe(false)
  expect(isTaxiAnimated(driving)).toBe(true)
  expect(isTaxiAnimated({ ...driving, gas: true })).toBe(false)
  expect(isTaxiAnimated({ ...parked, agents: 1 })).toBe(true)
  expect(isTaxiAnimated({ ...parked, bg: 1 })).toBe(true)

  expect(taxiSvg(parked, 1, 80, 7)).not.toContain('<animate')
  expect(taxiSvg({ ...parked, bg: 1 }, 1, 80, 7).match(/<animate /g)?.length).toBe(2)
  const moving = taxiSvg(driving, 999.99, 512, 7, 5000)
  expect(moving.match(/<animateTransform /g)?.length).toBe(2)
  expect(moving.match(/<animate /g)?.length).toBe(4) // wheels twice, exhaust twice
  expect(moving).toContain('begin="-5.00s"')
  expect(moving.length).toBeLessThan(131072)
  expect(taxiSvg(driving, 1, 20, 4)).not.toContain('fill-opacity') // the small car has no beam here
})
