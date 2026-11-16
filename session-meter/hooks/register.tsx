import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, SessionUsage, Timer } from 'claude-code'

import type {
  SessionMeterDays as Days,
  SessionMeterLedger as Ledger,
  SessionMeterSnapshot as Snap,
  SessionMeterTaxi as Taxi,
  SessionMeterTotals as Totals,
} from '../types'

// ponytail: TTL은 API가 주지 않아 상수. 5분 TTL이면 5로 바꿀 것
const CACHE_TTL_MIN = 60
const LIMIT_NAMES: Record<string, string> = { five_hour: '5시간', seven_day: '7일' }
const EMPTY: Snap = { limits: [], now: 0 }
const NO_LEDGER: Ledger = { id: '', lastCost: 0, days: {} }
const NO_TOTALS: Totals = { others: {}, backfill: {} }
const PARKED: Taxi = { mode: 'idle', gas: false, tripStart: 0, since: 0, bg: 0, agents: 0 }

const RASTER = 'road'
const FRAME_MS = 83
const IDLE_MS = 667
const ARRIVE_MS = 30_000
const GAS_MS = 1300

const snap = atom({ plugin: 'session-meter', key: 'snap' } as const, EMPTY, {
  shape: 'snap-1',
})
const ledger = atom({ plugin: 'session-meter', key: 'ledger' } as const, NO_LEDGER, {
  shape: 'ledger-1',
})
const totals = atom({ plugin: 'session-meter', key: 'totals' } as const, NO_TOTALS, {
  shape: 'totals-1',
})
const taxi = atom({ plugin: 'session-meter', key: 'taxi' } as const, PARKED, {
  shape: 'taxi-3',
})
const taxiOn = atom({ plugin: 'session-meter', key: 'taxiOn' } as const, true, {
  shape: 'taxi-on-1',
})

const cacheLeftMin = (s: Snap) =>
  s.lastAt === undefined ? undefined : CACHE_TTL_MIN - Math.floor((s.now - s.lastAt) / 60_000)

const bar = (pct: number, cells = 10) => {
  const n = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)))
  return '█'.repeat(n) + '░'.repeat(cells - n)
}

const hhmm = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const money = (v: number) => `$${v.toFixed(2)}`

const elapsed = (ms: number) => {
  const min = Math.max(0, Math.floor(ms / 60_000))
  return min < 60 ? `${min}분` : `${Math.floor(min / 60)}시간 ${min % 60}분`
}

const fromUsage = (u: Pick<SessionUsage, 'startedAt' | 'context' | 'rateLimits' | 'cost'>) => ({
  startedAt: u.startedAt,
  usd: u.cost?.usd,
  ctxPct: u.context.percent,
  limits: u.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
})

// The box's rows; empty until there is a figure to show.
export const meterRows = (s: Snap) => {
  const left = cacheLeftMin(s)
  const top = [
    s.usd !== undefined && `🚕 $${s.usd.toFixed(2)}`,
    s.ctxPct !== undefined && `ctx ${bar(s.ctxPct)} ${s.ctxPct}%`,
    left !== undefined && (left > 0 ? `캐시 ${left}분` : '캐시 만료'),
  ]
    .filter(Boolean)
    .join('   ')
  const limits = s.limits
    .map(l => {
      const reset = l.resetsAt ? ` (리셋 ${hhmm(l.resetsAt)})` : ''
      return `${LIMIT_NAMES[l.kind] ?? l.kind} ${bar(l.percentUsed)} ${l.percentUsed}%${reset}`
    })
    .join('   ')
  return [top, limits].filter(Boolean)
}

// --- Local dates, as 'YYYY-MM-DD'.

const pad2 = (n: number) => String(n).padStart(2, '0')

export const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

const dateOf = (key: string) => {
  const [y = 0, m = 1, d = 1] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const addDays = (key: string, n: number) => {
  const d = dateOf(key)
  d.setDate(d.getDate() + n)
  return dayKey(d.getTime())
}

/** The Monday of `key`'s week. */
export const weekStart = (key: string) => addDays(key, -((dateOf(key).getDay() + 6) % 7))

// --- The ledger.

export const applyCost = (l: Ledger, usd: number, day: string): Ledger => {
  const delta = usd - l.lastCost
  return {
    ...l,
    lastCost: usd,
    days: delta > 0 ? { ...l.days, [day]: (l.days[day] ?? 0) + delta } : l.days,
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

const daysOf = (v: unknown): Days =>
  isRecord(v) && isRecord(v.days)
    ? Object.fromEntries(
        Object.entries(v.days).filter((e): e is [string, number] => typeof e[1] === 'number'),
      )
    : {}

// A hot reload finds its own atom; a resume its stored row; a fork neither, and its cost
// already includes the parent's, so it counts from there.
const seedLedger = async ($: EngineInterface, id: string): Promise<Ledger> => {
  const held = await read($, ledger)
  if (held.id === id) return held
  const row = await $.store.get(`s:${id}`)
  if (isRecord(row) && typeof row.lastCost === 'number') {
    return { id, lastCost: row.lastCost, days: daysOf(row) }
  }
  return { id, lastCost: (await $.session.usage()).cost?.usd ?? 0, days: {} }
}

// ponytail: one store.get per s:* row per rescan, and the whole store caps at 4 MiB of JSON, about
// 20k sessions. Fine to thousands; past that, roll finished months into one key.
const rescan = async ($: EngineInterface) => {
  const own = `s:${(await read($, ledger)).id}`
  const keys = (await $.store.keys()).filter(k => k.startsWith('s:') && k !== own)
  const rows = await Promise.all(keys.map(k => $.store.get(k)))
  const others: Days = {}
  for (const row of rows) {
    for (const [day, usd] of Object.entries(daysOf(row))) others[day] = (others[day] ?? 0) + usd
  }
  const back = await $.store.get('backfill')
  const dataStart = isRecord(back) && typeof back.dataStart === 'string' ? back.dataStart : undefined
  await update($, totals, () => ({ others, backfill: daysOf(back), dataStart }))
}

const record = async ($: EngineInterface, usd: number, id: string) => {
  const [now, held] = await Promise.all([$.clock.now(), read($, ledger)])
  // The session moved under this process without a start we saw: never bill it to the old key.
  const moved = held.id !== id
  const seeded = moved ? await seedLedger($, id) : held
  const next = await update($, ledger, l => applyCost(l.id === id ? l : seeded, usd, dayKey(now)))
  await $.store.set(`s:${id}`, { lastCost: next.lastCost, days: next.days })
  if (moved) await rescan($)
}

// --- Figures.

const sumDays = (d: Days, from: string, to: string) =>
  Object.entries(d).reduce((sum, [day, usd]) => (day >= from && day <= to ? sum + usd : sum), 0)

type Figure = { usd: number; note: string }

const figure = (t: Totals, l: Ledger, from: string, to: string): Figure => {
  const live = sumDays(t.others, from, to) + sumDays(l.days, from, to)
  const back = sumDays(t.backfill, from, to)
  const notes = [
    back > 0 && (live > 0 ? '(일부 추정)' : '(추정)'),
    t.dataStart !== undefined && t.dataStart >= from && t.dataStart <= to && '부분 집계',
  ]
  return { usd: live + back, note: notes.filter(Boolean).join(' ') }
}

const monthEnds = (ym: string) => [`${ym}-01`, `${ym}-31`] as const

const periods = (t: Totals, l: Ledger, today: string) => {
  const monday = weekStart(today)
  const [first, last] = monthEnds(today.slice(0, 7))
  return {
    day: figure(t, l, today, today),
    week: figure(t, l, monday, addDays(monday, 6)),
    month: figure(t, l, first, last),
  }
}

export const totalsRow = (t: Totals, l: Ledger, today: string) => {
  const { day, week, month } = periods(t, l, today)
  return `오늘 ${money(day.usd)}   이번 주 ${money(week.usd)}   이번 달 ${money(month.usd)}`
}

const tableRow = (label: string, f: Figure) =>
  `  ${label.padEnd(13)} ${money(f.usd).padStart(10)}  ${f.note}`.trimEnd()

export const meterReport = (s: Snap, t: Totals, l: Ledger, today: string) => {
  const rows = meterRows(s)
  const allDays = [t.others, t.backfill, l.days].flatMap(d => Object.keys(d))
  if (rows.length === 0 && allDays.length === 0) return '아직 측정값이 없어요.'

  const { day, week, month } = periods(t, l, today)
  const labelled = (name: string, f: Figure) => `${name} ${money(f.usd)}${f.note && ` ${f.note}`}`
  const out = [
    ...rows,
    '',
    [labelled('오늘', day), labelled('이번 주', week), labelled('이번 달', month)].join('   '),
    '',
    '이번 달 주별 (월요일 시작)',
  ]
  const ym = today.slice(0, 7)
  for (let from = weekStart(`${ym}-01`); from <= today; from = addDays(from, 7)) {
    const to = addDays(from, 6)
    out.push(tableRow(`${from.slice(5).replace('-', '/')}~${to.slice(5).replace('-', '/')}`, figure(t, l, from, to)))
  }
  out.push('', '월별')
  for (const m of [...new Set([...allDays.map(d => d.slice(0, 7)), ym])].sort()) {
    const [first, last] = monthEnds(m)
    out.push(tableRow(m, figure(t, l, first, last)))
  }
  out.push(
    '',
    t.dataStart === undefined
      ? '/meter backfill 로 지난 기록을 불러올 수 있어요.'
      : `(추정)은 대화 기록으로 계산한 값으로, 실제보다 5~9% 낮게 나와요. 기록은 ${t.dataStart}부터 있어요.`,
  )
  return out.join('\n')
}

// --- Backfill.

type Backfill = { days: Days; dataStart?: string }

// Transcripts past cleanupPeriodDays disappear, so a re-run only ever raises a day.
export const mergeBackfill = (old: Backfill, fresh: Backfill): Backfill => {
  const days = { ...old.days }
  for (const [day, usd] of Object.entries(fresh.days)) days[day] = Math.max(days[day] ?? 0, usd)
  const starts = [old.dataStart, fresh.dataStart].filter((d): d is string => !!d).sort()
  return { days, dataStart: starts[0] }
}

const liveStart = async ($: EngineInterface) => {
  const stored = await $.store.get('liveStart')
  if (typeof stored === 'string') return stored
  const iso = new Date(await $.clock.now()).toISOString()
  await $.store.set('liveStart', iso)
  return iso
}

const runBackfill = async ($: EngineInterface) => {
  const script = `${$.plugin.root}/scripts/backfill.py`
  let out
  try {
    out = await $.process.run(['/usr/bin/python3', '-I', script, await liveStart($)], {
      timeoutMs: 120_000,
    })
  } catch (error) {
    return `백필을 실행하지 못했어요: ${error instanceof Error ? error.message : String(error)}`
  }
  if (out.exitCode !== 0) return `백필이 실패했어요 (종료 코드 ${out.exitCode}): ${out.stderr.slice(0, 300)}`

  let parsed: unknown
  try {
    parsed = JSON.parse(out.stdout)
  } catch {
    return '백필 결과를 읽지 못했어요.'
  }
  const fresh: Backfill = {
    days: daysOf(parsed),
    dataStart: isRecord(parsed) && typeof parsed.dataStart === 'string' ? parsed.dataStart : undefined,
  }
  const stored = await $.store.get('backfill')
  const merged = mergeBackfill(
    { days: daysOf(stored), dataStart: isRecord(stored) && typeof stored.dataStart === 'string' ? stored.dataStart : undefined },
    fresh,
  )
  await $.store.set('backfill', merged)
  await rescan($)

  const dates = Object.keys(merged.days).sort()
  const sum = Object.values(merged.days).reduce((a, b) => a + b, 0)
  const unpriced = isRecord(parsed) && isRecord(parsed.unpriced) ? Object.keys(parsed.unpriced) : []
  return [
    `백필을 마쳤어요: 합계 ${money(sum)} (추정), ${dates[0] ?? '-'} ~ ${dates.at(-1) ?? '-'}`,
    unpriced.length > 0 && `가격을 몰라 뺀 모델: ${unpriced.join(', ')}`,
  ]
    .filter(Boolean)
    .join('\n')
}

// --- The taxi: 16 pixels tall at most, one cell to two pixels. A bump lifts the body one pixel and
// the wheels two. Fewer rows lower the buildings; below BIG_CAR_ROWS the small car drives.

const H = 16
const ROAD = 2 // pixels under the ground line
const BIG_CAR_ROWS = 7 // the big car's 11 pixels and the road
const BIG_CAR_COLS = 24
const SMALL_CAR_COLS = 14
const rgb = (hex: string) => Number.parseInt(hex.slice(1), 16)
const COLOR = {
  sky: rgb('#0b1121'),
  starDim: rgb('#6a7290'),
  star: rgb('#c5cbe0'),
  lit: rgb('#d9b75c'),
  wall: rgb('#1a2238'),
  gas: rgb('#e8483f'),
  white: rgb('#ffffff'),
  road: rgb('#1c2030'),
  kerb: rgb('#3b4158'),
  dash: rgb('#d9dbe4'),
  bump: rgb('#f0c040'),
  bumpStripe: rgb('#5a5f70'),
  beam: rgb('#fff3a8'),
  lamp: rgb('#ff4d3d'),
  bgLamp: rgb('#ffb020'),
  bgLampDim: rgb('#6b4a0e'),
  fare: rgb('#ffd84a'),
  panel: rgb('#2a0806'),
  panelEdge: rgb('#5a5f70'),
  ledDim: rgb('#7a241c'),
  pole: rgb('#c9ccd6'),
  checkLight: rgb('#f4f4f4'),
  checkDark: rgb('#1b1d24'),
}
const PAL: Record<string, number> = {
  Y: rgb('#ffc92e'),
  y: rgb('#d99a14'),
  K: rgb('#1b1d24'),
  G: rgb('#8fd3ff'),
  g: rgb('#5aa6d6'),
  W: rgb('#f4f4f4'),
  R: rgb('#ff4d3d'),
  L: rgb('#fff3a8'),
  C: rgb('#5a5f70'),
  H: rgb('#c9ccd6'),
  B: rgb('#3b3f4b'),
}
const TAXI = [
  '........WWWWWW..........',
  '........KKKKKK..........',
  '......YYYYYYYYYYYY......',
  '.....YGGGGYYGGGGGYY.....',
  '....YGGgGGYYGGGgGGYY....',
  '...YYYYYYYYYYYYYYYYYYY..',
  '.RYYKWKWKWKWKWKYYYYYYYL.',
  '.RYYYYYYYYYYYYYYYYYYYYL.',
  '.yyyy....yyyyyyyy....yy.',
]
const WHEEL = [
  ['.CCC.', 'CCHCC', '.CCC.'],
  ['.CHC.', 'CCCCC', '.CHC.'],
]
const SMALL_TAXI = [
  '....WWWW......',
  '...YYYYYYY....',
  '..YGGYGGGYY...',
  '.RYYYYYYYYYYL.',
  '.RYKWKWYYYYYL.',
]
const SMALL_WHEEL = [
  ['CHC', 'CCC'],
  ['CCC', 'CHC'],
]
const STARS = [
  [6, 2],
  [20, 4],
  [41, 1],
  [58, 3],
  [67, 5],
] as const
const FONT = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111']
const METER_PLACES = [[10000, 0], [1000, 4], [100, 8], [10, 14], [1, 18]] as const // cents, x past the panel's padding
const CITY_WRAP = 600
const CITY: { x: number; w: number; h: number; lit: number }[] = []
for (let x = 0, i = 0; x < CITY_WRAP; i++) {
  const w = 6 + ((i * 7) % 7)
  CITY.push({ x, w, h: 4 + ((i * 5) % 8), lit: i * 13 })
  x += w + 1 + (i % 3)
}

// In proportion to the sky, so a short scene keeps the skyline's ups and downs.
const cityTall = (b: (typeof CITY)[number], ground: number) => Math.ceil((b.h * ground) / (H - ROAD))
const cityLit = (b: (typeof CITY)[number], i: number, j: number) => i % 2 === 1 && j % 2 === 1 && (b.lit + i * 3 + j) % 4 !== 0

export type Scene = {
  t: number
  scroll: number
  speed: number
  wantBump: boolean
  bump?: { x: number; hit: boolean }
  floats: { x: number; y: number; life: number }[]
  /** The figure the LED shows; undefined until the first step, which snaps to fareTo. */
  fare?: number
  /** The session's real cost, as of the last drawing. */
  fareTo: number
}

export const newScene = (): Scene => ({
  t: 0,
  scroll: 0,
  speed: 0,
  wantBump: false,
  floats: [],
  fareTo: 0,
})

type Drive = Pick<Taxi, 'mode' | 'gas' | 'bg' | 'agents'>

const isDriving = (x: Drive) => x.mode === 'drive' || x.agents > 0

/** Whether the road picture has room for the LED panel and it has room for the fare. */
export const meterFits = (cols: number, rows: number, usd: number) => cols >= 76 && rows >= 7 && Math.round(usd * 100) < 100_000

const carX = (cols: number) => (cols >= 56 ? 14 : Math.max(0, Math.floor((cols - BIG_CAR_COLS) / 3)))

/** Advances one frame; `dt` moves only the blink clock, for the slow timer. */
export const stepScene = (s: Scene, x: Drive, cols: number, dt = 1) => {
  const going = isDriving(x) && !x.gas
  s.speed += ((going ? 1 : 0) - s.speed) * 0.12
  if (s.speed < 0.03) s.speed = 0
  s.scroll += s.speed

  if (s.wantBump && !s.bump && s.speed > 0) s.bump = { x: Math.min(cols + 2, carX(cols) + 28), hit: false }
  s.wantBump = false
  if (s.bump) {
    s.bump.x -= s.speed
    if (s.bump.x < carX(cols) + 19 && !s.bump.hit) {
      s.bump.hit = true
      s.floats.push({ x: carX(cols) + 8, y: 2, life: 18 })
    }
    if (s.bump.x < -9 || (s.speed === 0 && !going)) s.bump = undefined
  }

  for (const f of s.floats) {
    f.y -= 0.03
    f.life--
  }
  s.floats = s.floats.filter(f => f.life > 0)
  s.t += dt
  s.fare =
    s.fare === undefined || s.fareTo < s.fare
      ? s.fareTo
      : Math.min(s.fareTo, s.fare + Math.max(0.01, (s.fareTo - s.fare) * 0.2))
}

/** Whether the next frame can differ by more than a blink: pick the fast timer. An unset fare will snap, not roll. */
export const isMoving = (s: Scene, x: Drive) =>
  (isDriving(x) && !x.gas) || s.speed > 0 || s.floats.length > 0 || (s.fare !== undefined && s.fare !== s.fareTo)

/** One color per pixel, row-major, `cols * rows * 2`. */
/** `scenery` false leaves out what the animated SVG moves or layers behind: stars, city, lane dashes. */
export const paintScene = (s: Scene, x: Drive, cols: number, rows = H / 2, scenery = true) => {
  const h = rows * 2
  const ground = h - ROAD
  const small = rows < BIG_CAR_ROWS || cols < BIG_CAR_COLS
  const driving = isDriving(x)
  // By fareTo, as the render hook decides: the two agree on whether the text drops its fare.
  const meter = meterFits(cols, rows, s.fareTo)
  const p = new Uint32Array(cols * h).fill(COLOR.sky)
  const px = (px: number, py: number, c: number) => {
    const a = Math.round(px)
    const b = Math.round(py)
    if (a >= 0 && a < cols && b >= 0 && b < h) p[b * cols + a] = c
  }
  const glow = (gx: number, gy: number, c: number, alpha: number) => {
    const a = Math.round(gx)
    const b = Math.round(gy)
    if (a < 0 || a >= cols || b < 0 || b >= h) return
    const under = p[b * cols + a] ?? 0
    const mix = (shift: number) => {
      const from = (under >> shift) & 255
      return Math.round(from + (((c >> shift) & 255) - from) * alpha) << shift
    }
    p[b * cols + a] = mix(16) | mix(8) | mix(0)
  }
  const rect = (rx: number, ry: number, w: number, h: number, c: number) => {
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) px(rx + i, ry + j, c)
  }
  const sprite = (rows: readonly string[], sx: number, sy: number) => {
    rows.forEach((r, j) => {
      ;[...r].forEach((c, i) => {
        const color = PAL[c]
        if (color !== undefined) px(sx + i, sy + j, color)
      })
    })
  }

  if (scenery) {
    STARS.forEach(([sx, sy], i) => {
      px(sx, sy, i % 2 === 1 ? COLOR.starDim : COLOR.star)
    })
  }

  for (const b of scenery ? CITY : []) {
    const bx = ((((b.x - s.scroll * 0.3) % CITY_WRAP) + CITY_WRAP) % CITY_WRAP) - 20
    if (bx >= cols) continue
    const tall = cityTall(b, ground)
    for (let i = 0; i < b.w; i++) {
      for (let j = 0; j < tall; j++) {
        px(bx + i, ground - 1 - j, cityLit(b, i, j) ? COLOR.lit : COLOR.wall)
      }
    }
  }

  if (x.gas) {
    const gx = meter ? 39 : Math.min(52, cols - 10)
    const tall = Math.min(9, ground - 1)
    for (let j = 0; j < tall; j++) {
      px(gx, ground - 1 - j, COLOR.gas)
      px(gx + 8, ground - 1 - j, COLOR.gas)
    }
    rect(gx, ground - tall - 1, 9, 1, COLOR.gas)
    rect(gx, ground - tall, 9, 1, COLOR.white)
  }

  rect(0, ground, cols, ROAD, COLOR.road)
  rect(0, ground, cols, 1, COLOR.kerb)
  for (let i = 0; i < cols; i++) {
    if (scenery && (i + Math.floor(s.scroll)) % 8 < 4) px(i, ground + 1, COLOR.dash)
  }

  const car = carX(cols)
  const bx = s.bump && Math.round(s.bump.x)
  if (bx !== undefined) {
    const stripe = (i: number) => ((i >> 1) % 2 === 0 ? COLOR.bump : COLOR.bumpStripe)
    for (let i = 0; i < 8; i++) px(bx + i, ground - 1, stripe(i))
    for (let i = 1; i < 7; i++) px(bx + i, ground - 2, stripe(i))
  }

  if (meter) {
    const mx = cols - 28
    rect(mx, 2, 26, 9, COLOR.panelEdge)
    rect(mx + 1, 3, 24, 7, COLOR.panel)
    // Never above fareTo, the figure meterFits passed: five digits hold whatever is painted.
    const cents = Math.round(Math.min(s.fare ?? s.fareTo, s.fareTo) * 100)
    const led = driving ? COLOR.lamp : x.mode === 'arrive' ? COLOR.fare : COLOR.ledDim
    px(mx + 14, 8, led)
    for (const [place, off] of METER_PLACES) {
      if (place >= 1000 && cents < place) continue
      const glyph = FONT[Math.floor(cents / place) % 10] ?? ''
      for (let j = 0; j < 5; j++) {
        for (let i = 0; i < 3; i++) if (glyph[j * 3 + i] === '1') px(mx + 2 + off + i, 4 + j, led)
      }
    }
  }

  // The small car stands where the big one's wheels do; a short scene limits the lift to its sky.
  const carH = small ? 6 : 11
  const carLeft = small ? Math.min(car + 8, cols - SMALL_CAR_COLS) : car
  const rise = (center: number) => {
    if (bx === undefined) return 0
    const d = center - bx
    return d >= 1 && d <= 6 ? 2 : d >= 0 && d <= 7 ? 1 : 0
  }
  const rearRise = rise(carLeft + (small ? 3 : 6))
  const frontRise = rise(carLeft + (small ? 10 : 18))
  const lift = Math.min(rearRise > 0 || frontRise > 0 ? 1 : 0, ground - carH)
  const y = ground - carH - lift
  const nose = small ? 13 : 23
  const beamY = small ? 3 : 7
  if (s.speed > 0.4) {
    for (let i = 1; i < 12; i++) glow(carLeft + nose + i, y + beamY + (i >> 2), COLOR.beam, 0.42 - i * 0.03)
    if (s.t % 3 === 0) px(carLeft - 1 - (s.t % 6), y + beamY + 1, COLOR.starDim)
  }
  sprite(small ? SMALL_TAXI : TAXI, carLeft, y)
  // Moving: the main agent's turn or a subagent's. A blinking lamp: background work alone. No change: stopped.
  const blinking = !driving && x.bg > 0
  if (blinking || (!driving && x.mode === 'idle')) {
    const lamp = !blinking ? COLOR.lamp : ((s.t >> 3) & 1) === 1 ? COLOR.bgLamp : COLOR.bgLampDim
    if (small) rect(carLeft + 4, y, 4, 1, lamp)
    else rect(car + 8, y, 6, 1, lamp)
  }
  const wheel = (small ? SMALL_WHEEL : WHEEL)[Math.floor(s.scroll) % 2] ?? []
  const drawWheel = (wx: number, raised: number) => {
    // With no sky to lift into, the body stays down and the wheel can climb only so far into it.
    const up = Math.min(raised, lift + 1)
    sprite(wheel, wx, ground - wheel.length - up)
    // The big car's wheel arch rose off a wheel still on the road: a strut keeps it attached.
    if (!small && lift > up) sprite(['CCC'], wx + 1, ground - wheel.length - 1)
  }
  drawWheel(carLeft + (small ? 2 : 4), rearRise)
  drawWheel(carLeft + (small ? 9 : 16), frontRise)

  for (const f of s.floats) {
    rect(f.x, f.y, 7, 1, COLOR.fare)
    px(f.x + 3, f.y - 1, COLOR.fare)
    px(f.x + 3, f.y + 1, COLOR.fare)
  }

  if (x.mode === 'arrive' && s.speed === 0) {
    const fx = meter ? 40 : Math.min(49, cols - 8)
    const pole = Math.min(14, ground)
    for (let j = 0; j < pole; j++) px(fx, ground - 1 - j, COLOR.pole)
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 4; j++) {
        px(fx + 1 + i, ground - pole + j, (i + j) % 2 === 1 ? COLOR.checkLight : COLOR.checkDark)
      }
    }
  }
  return p
}

const UPPER_HALF = 0x2580

/** RasterProps `cells`: an upper half block per cell, its foreground the upper pixel. */
export const taxiFrame = (s: Scene, x: Drive, cols: number, rows = H / 2) => {
  const p = paintScene(s, x, cols, rows)
  const words = new Uint32Array(cols * rows * 3)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const at = (r * cols + c) * 3
      words[at] = UPPER_HALF
      words[at + 1] = p[r * 2 * cols + c] ?? 0
      words[at + 2] = p[(r * 2 + 1) * cols + c] ?? 0
    }
  }
  const bytes = new Uint8Array(words.buffer) as Uint8Array & { toBase64: () => string }
  return bytes.toBase64()
}

// Surfaces without Raster get an SVG of the same scene at the band's size. Whatever the terminal
// runs on a timer without events is SMIL here: the city and lane dashes slide, the wheels and the
// background lamp swap, the exhaust puffs, at the terminal's own speeds.
const SVG_SCALE = 6 // CSS pixels to a scene pixel
const DASH_PERIOD = 8
const WHEEL_S = (2 * FRAME_MS) / 1000
const LAMP_S = (2 * IDLE_MS) / 1000
const PUFF_S = (6 * FRAME_MS) / 1000
const DASH_S = (DASH_PERIOD * FRAME_MS) / 1000
const CITY_S = (CITY_WRAP / 0.3) * (FRAME_MS / 1000)

const hexOf = (c: number) => `#${c.toString(16).padStart(6, '0')}`

const cityPaths = (cols: number, ground: number) => {
  let walls = ''
  let windows = ''
  const building = (b: (typeof CITY)[number], left: number) => {
    const tall = cityTall(b, ground)
    walls += `M${left} ${ground - tall}h${b.w}v${tall}h-${b.w}z`
    for (let i = 1; i < b.w; i += 2) {
      for (let j = 1; j < tall; j += 2) {
        if (cityLit(b, i, j)) windows += `M${left + i} ${ground - 1 - j}h1v1h-1z`
      }
    }
  }
  for (const b of CITY) {
    building(b, b.x)
    if (b.x < cols + 20) building(b, b.x + CITY_WRAP) // the skyline's start, again past its end
  }
  return `<path d="${walls}" fill="${hexOf(COLOR.wall)}"/><path d="${windows}" fill="${hexOf(COLOR.lit)}"/>`
}

const slide = (distance: number, seconds: number, begin = 0) =>
  `<animateTransform attributeName="transform" type="translate" from="0 0" to="-${distance} 0" dur="${seconds}s" begin="-${begin.toFixed(2)}s" repeatCount="indefinite"/>`

const flip = (rects: string, first: boolean, seconds: number) =>
  `<g opacity="${first ? 1 : 0}">${rects}<animate attributeName="opacity" values="${first ? '1;0' : '0;1'}" calcMode="discrete" dur="${seconds}s" repeatCount="indefinite"/></g>`

const puff = (x: number, y: number, frames: string) =>
  `<rect x="${x}" y="${y}" width="1" height="1" fill="${hexOf(COLOR.starDim)}" opacity="0"><animate attributeName="opacity" values="${frames}" calcMode="discrete" dur="${PUFF_S}s" repeatCount="indefinite"/></rect>`

/** Whether the picture has anything on a timer: it then needs the frame that plays SMIL. */
export const isTaxiAnimated = (x: Drive) => (isDriving(x) && !x.gas) || (!isDriving(x) && x.bg > 0)

/** `cols` and `rows` as the terminal's Raster; `nowMs` keeps the skyline in place across a redraw. */
export const taxiSvg = (x: Drive, usd: number, cols: number, rows: number, nowMs = 0) => {
  const h = rows * 2
  const ground = h - ROAD
  const runs = (at: (c: number, r: number) => number | undefined) => {
    let out = ''
    for (let r = 0; r < h; r++) {
      for (let from = 0, to = 1; from < cols; from = to, to = from + 1) {
        const color = at(from, r)
        while (to < cols && at(to, r) === color) to++
        if (color !== undefined) out += `<rect x="${from}" y="${r}" width="${to - from}" height="1" fill="${hexOf(color)}"/>`
      }
    }
    return out
  }
  const notSky = (c: number | undefined) => (c === COLOR.sky ? undefined : c)
  const doc = (body: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * SVG_SCALE}" height="${h * SVG_SCALE}" viewBox="0 0 ${cols} ${h}" shape-rendering="crispEdges"><rect width="${cols}" height="${h}" fill="${hexOf(COLOR.sky)}"/>${body}</svg>`
  const twoFrames = (a: Uint32Array, b: Uint32Array, seconds: number) => {
    const at = (p: Uint32Array, c: number, r: number) => p[r * cols + c]
    const differ = (c: number, r: number) => at(a, c, r) !== at(b, c, r)
    return {
      same: runs((c, r) => (differ(c, r) ? undefined : notSky(at(a, c, r)))),
      flips: [a, b].map((p, i) => flip(runs((c, r) => (differ(c, r) ? notSky(at(p, c, r)) : undefined)), i === 0, seconds)).join(''),
    }
  }

  const scene: Scene = { ...newScene(), fareTo: usd }
  if (!isTaxiAnimated(x)) {
    const p = paintScene(scene, x, cols, rows)
    return doc(runs((c, r) => notSky(p[r * cols + c])))
  }
  if (!isDriving(x)) {
    const { same, flips } = twoFrames(paintScene(scene, x, cols, rows), paintScene({ ...scene, t: 8 }, x, cols, rows), LAMP_S)
    return doc(same + flips)
  }

  // The car, road and panel at each wheel position, with no scenery: what differs is the wheels.
  const { same, flips } = twoFrames(
    paintScene(scene, x, cols, rows, false),
    paintScene({ ...scene, scroll: 1 }, x, cols, rows, false),
    WHEEL_S,
  )
  const stars = STARS.map(([sx, sy], i) => `<rect x="${sx}" y="${sy}" width="1" height="1" fill="${hexOf(i % 2 === 1 ? COLOR.starDim : COLOR.star)}"/>`).join('')
  let dashes = ''
  for (let i = 0; i < cols + DASH_PERIOD; i += DASH_PERIOD) dashes += `<rect x="${i}" y="${ground + 1}" width="4" height="1" fill="${hexOf(COLOR.dash)}"/>`
  // The beam blends over a moving city, so it is drawn translucent; the big car's nose and exhaust.
  let exhaust = ''
  if (rows >= BIG_CAR_ROWS && cols >= BIG_CAR_COLS) {
    const left = carX(cols)
    const y = ground - 11 + 7
    for (let i = 1; i < 12; i++) exhaust += `<rect x="${left + 23 + i}" y="${y + (i >> 2)}" width="1" height="1" fill="${hexOf(COLOR.beam)}" fill-opacity="${(0.42 - i * 0.03).toFixed(2)}"/>`
    exhaust += puff(left - 1, y + 1, '1;0;0;0;0;0') + puff(left - 4, y + 1, '0;0;0;1;0;0')
  }
  const cityAt = (nowMs / 1000) % CITY_S
  return doc(`${stars}<g>${cityPaths(cols, ground)}${slide(CITY_WRAP, CITY_S, cityAt)}</g>${same}<g>${dashes}${slide(DASH_PERIOD, DASH_S)}</g>${flips}${exhaust}`)
}

const taxiLabel = (x: Taxi, fuel: number) => {
  if (x.gas) return '주유 중'
  if (x.mode === 'drive') return fuel <= LOW_FUEL ? '연료 부족' : '주행 중'
  if (x.agents > 0) return `서브에이전트 ${x.agents}개${x.bg > 0 ? ` · 백그라운드 ${x.bg}개` : ''}`
  if (x.bg > 0) return `백그라운드 ${x.bg}개`
  return x.mode === 'arrive' ? '도착' : '빈차'
}

// --- The band.

type Segment = { text: string; color?: string; bold?: boolean; dim?: boolean }

const FARE = '#ffd84a'
const LOW_FUEL = 10
const HALF_FUEL = 50
const ALERT = '#ff6b5e'
const CAUTION = '#f0c040'
const CACHE_WARN_MIN = 10
const MAX_RASTER_COLUMNS = 512

export const bandRows = (s: Snap, t: Totals, l: Ledger, x: Taxi, today: string, panel = false): Segment[][] => {
  const fuel = 100 - (s.ctxPct ?? 0)
  const usd = s.usd ?? 0
  const arrived = x.mode === 'arrive'
  const left = cacheLeftMin(s)
  const gauges: Segment[] = s.limits
    .filter(lim => lim.kind === 'seven_day')
    .map(lim => {
      const reset = lim.resetsAt ? ` (리셋 ${'일월화수목금토'[new Date(lim.resetsAt).getDay()]} ${hhmm(lim.resetsAt)})` : ''
      return {
        text: `   ${LIMIT_NAMES[lim.kind]} ${bar(lim.percentUsed)} ${lim.percentUsed}%${reset}`,
        color: lim.percentUsed >= 95 ? ALERT : lim.percentUsed >= 80 ? CAUTION : undefined,
      }
    })
  return [
    [
      // The panel shows the fare, rolling; a final number beside it would give the roll away.
      ...(panel ? [] : [{ text: '요금 ' }, { text: money(usd), color: FARE, bold: true }, { text: '   ' }]),
      { text: `이번 운행 ${money(Math.max(0, usd - x.tripStart))}`, color: FARE, bold: arrived, dim: !arrived },
      { text: '   ' },
      { text: taxiLabel(x, fuel), dim: true },
      ...(s.startedAt === undefined ? [] : [{ text: `   운행 ${elapsed(s.now - s.startedAt)}`, dim: true }]),
      ...(left === undefined
        ? []
        : [
            {
              text: `   ${left > 0 ? `캐시 ${left}분` : '캐시 만료'}`,
              color: left <= 0 ? ALERT : left <= CACHE_WARN_MIN ? CAUTION : undefined,
            },
          ]),
    ],
    [
      { text: '연료 ' },
      { text: bar(fuel), color: fuel <= LOW_FUEL ? ALERT : fuel < HALF_FUEL ? CAUTION : '#5fd38a' },
      { text: ` ${fuel}%` },
      ...gauges,
    ],
    [{ text: totalsRow(t, l, today), dim: true }],
  ]
}

// Hangul takes two cells, the bars and digits one.
const cellWidth = (text: string) => [...text].reduce((n, c) => n + (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/.test(c) ? 2 : 1), 0)

const BOX_EDGE = 4 // the border and paddingX, across
const MIN_ROAD = SMALL_CAR_COLS
const BORDER_ROWS = 2
const MIN_TAXI_ROWS = 4 // the small car and the road
const MAX_TAXI_ROWS = BIG_CAR_ROWS // the tallest the band draws it: the big car and the LED panel still fit

// Greedy by word, as the terminal wraps: Hangul words stay whole, so dividing by the width comes up short.
export const wrappedRows = (text: string, width: number) => {
  let rows = 1
  let at = 0
  for (const word of text.split(' ')) {
    const w = cellWidth(word)
    if (at > 0 && at + 1 + w > width) {
      rows++
      at = 0
    } else if (at > 0) at++
    at += w
    while (at > width) {
      rows++
      at -= width
    }
  }
  return rows
}

/** The taxi's rows and whether the border still fits in the band's rows; undefined: text alone. */
export const taxiLayout = (rows: Segment[][], bodyColumns: number, maxRows: number) => {
  const width = bodyColumns - BOX_EDGE
  if (width < MIN_ROAD) return undefined
  const text = rows.reduce(
    (n, row) => n + wrappedRows(row.map(seg => seg.text).join(''), width),
    0,
  )
  const room = maxRows - text
  // A half-height terminal gives so few rows that the border makes way.
  const border = room - BORDER_ROWS >= MIN_TAXI_ROWS
  const space = border ? room - BORDER_ROWS : room
  if (space < MIN_TAXI_ROWS) return undefined
  return { rows: Math.min(space, MAX_TAXI_ROWS), border }
}

const loadTaxiOn = async ($: EngineInterface) => {
  const stored = await $.store.get('taxiOn')
  await update($, taxiOn, () => stored !== false)
}

// Module variables: a reload starts them over, and the render hook starts the timer again.
let scene = newScene()
let cols = 72
let taxiRows = H / 2
let band = ''
let anim: Timer | undefined
let animFast = false
let denied = 0

const stopAnim = () => {
  anim?.cancel()
  anim = undefined
}

const DENY_RETRIES = 3
const RETRY_MS = 500

const frame = async ($: EngineInterface) => {
  const mine = anim
  const x = await read($, taxi)
  stepScene(scene, x, cols, animFast ? 1 : 8)
  const shown = await $.ui.blit({ requestId: band, key: RASTER, cells: taxiFrame(scene, x, cols, taxiRows) })
  // An old frame still in flight has no say over the timer that replaced it.
  if (anim !== mine) return
  if (!shown.deny) {
    denied = 0
    startAnim($, isMoving(scene, x))
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

export const register: Register = on => {
  let tick: Timer | undefined

  on('session.start', async ($, e, next) => {
    await Promise.all([
      $.command.register({
        name: 'meter',
        description: '세션·기간별 요금, 컨텍스트, 캐시, 사용 한도 보기',
        argumentHint: '[backfill]',
      }),
      $.command.register({ name: 'taxi', description: '계기판의 택시 켜기·끄기' }),
    ])
    const [u, now, id] = await Promise.all([$.session.usage(), $.clock.now(), $.session.id()])
    await update($, snap, s => ({ ...s, ...fromUsage(u), now }))
    await liveStart($)
    const seeded = await seedLedger($, id)
    await update($, ledger, () => seeded)
    await loadTaxiOn($)
    await rescan($)
    // Timers that would have ended these went with the reload.
    await update($, taxi, (x): Taxi => ({ ...x, gas: false, mode: x.mode === 'arrive' ? 'idle' : x.mode }))
    // A reload drops the old environment's timers; this guards a second start in the same one.
    tick?.cancel()
    tick = $.clock.every(60_000, async () => {
      const now = await $.clock.now()
      await update($, snap, s => ({ ...s, now }))
      await rescan($)
    })
    // ponytail: 0.2.0 opened this pane and a reload leaves it up; drop this once no session runs 0.2.0.
    await $.ui.close({ id: 'session-taxi' }).catch(() => {})
    // A band that stayed up through a reload needs drawing to start its timer again.
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // /clear fires no session.start: the new id first shows here, its cost at 0.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear') {
      await update($, ledger, () => ({ id: e.session_id, lastCost: 0, days: {} }))
      await update($, taxi, () => PARKED)
      await loadTaxiOn($)
      scene = newScene()
      await rescan($)
    }
    // Another session's count says nothing of this one's.
    if (e.source === 'resume' || e.source === 'fork') await update($, taxi, x => ({ ...x, bg: 0, agents: 0 }))
    return next(e)
  })

  on('command.run', { command: 'meter' }, async ($, e) => {
    if (e.args.trim() === 'backfill') return { text: await runBackfill($) }
    await rescan($)
    const [s, t, l, now] = await Promise.all([read($, snap), read($, totals), read($, ledger), $.clock.now()])
    return { text: meterReport(s, t, l, dayKey(now)) }
  })

  on('command.run', { command: 'taxi' }, async $ => {
    const wanted = !(await read($, taxiOn))
    await $.store.set('taxiOn', wanted)
    await update($, taxiOn, () => wanted)
    return { text: wanted ? '택시를 켰어요.' : '택시를 껐어요.' }
  })

  on('session.measure', async ($, e, next) => {
    // The event has no startedAt; usage's does, and is how /clear and a resume restart the count.
    const [now, { startedAt }] = await Promise.all([$.clock.now(), $.session.usage()])
    // Only a main-thread request moves the context fill; a subagent's rate-limit tick must not reset the cache clock.
    const isMain = e.changed.includes('context')
    await update($, snap, s => ({ ...s, ...fromUsage({ ...e, startedAt }), now, lastAt: isMain ? now : s.lastAt }))
    if (e.cost) await record($, e.cost.usd, await $.session.id())
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // A measure may come only at a turn's end; an exit mid-turn would lose the rest.
    // By the ending session's own id, and only while the ledger is still its: usage may no longer be.
    // A session's cost only rises, so a lower figure is another session's; an in-process resume's is too.
    const [{ cost }, held] = await Promise.all([$.session.usage(), read($, ledger)])
    if (cost && e.reason !== 'resume' && held.id === e.sessionId && cost.usd > held.lastCost) {
      await record($, cost.usd, e.sessionId)
    }
    if (e.reason === 'clear' || e.reason === 'resume') await update($, snap, () => EMPTY)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const { cost } = await $.session.usage()
    await update($, taxi, (x): Taxi => ({ ...x, mode: 'drive', tripStart: cost?.usd ?? 0 }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const since = await $.clock.now()
    // No Stop follows a turn that did not answer: no count to trust, and a false blink outlasts a missed one.
    await update($, taxi, (x): Taxi => ({ ...x, mode: 'arrive', since, ...(e.reason === 'answer' ? {} : { bg: 0, agents: 0 }) }))
    $.clock.after(ARRIVE_MS, () => {
      void update($, taxi, (x): Taxi => (x.mode === 'arrive' && x.since === since ? { ...x, mode: 'idle' } : x))
    })
    return next(e)
  })

  // ponytail: the counts refresh only at a main turn's end. A task finishing normally wakes a turn
  // through its notification; one killed from the UI wakes nothing, so the lamp blinks, or a killed
  // agent keeps the taxi driving, until the next turn's end. An interrupted or failed turn clears the
  // counts, so work still running looks stopped until then.
  on('classic.Stop', async ($, e, next) => {
    if (e.agent_id !== undefined) return next(e)
    const tasks = e.background_tasks ?? []
    const agents = tasks.filter(task => task.type === 'subagent' || task.type === 'workflow').length
    await update($, taxi, x => ({ ...x, agents, bg: tasks.length - agents }))
    return next(e)
  })

  on('tool.call', ($, e, next) => {
    scene.wantBump = true
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await update($, taxi, x => ({ ...x, gas: true }))
    try {
      return await next(e)
    } finally {
      $.clock.after(GAS_MS, () => {
        void update($, taxi, x => ({ ...x, gas: false }))
      })
    }
  })

  // Turn events, not e.props.isWorking, set the mode: isWorking also covers subagent turns, and a
  // render writes no state. Its flips still come here as redraws, which restart a stopped timer.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    if (e.props.hasSurvey || meterRows(s).length === 0) {
      stopAnim()
      return next(e)
    }

    const [t, l, x, wanted, now] = await Promise.all([
      read($, totals),
      read($, ledger),
      read($, taxi),
      read($, taxiOn),
      $.clock.now(),
    ])
    const full = bandRows(s, t, l, x, dayKey(now))
    // Off the terminal there is no road, so no panel. The layout measures the longer row.
    const layout = wanted && e.surface === 'terminal' ? taxiLayout(full, e.props.bodyColumns, e.props.maxRows) : undefined
    const roadCols = Math.min(MAX_RASTER_COLUMNS, e.props.bodyColumns - BOX_EDGE)
    const onTerminal = e.surface === 'terminal'
    const roadRows = onTerminal ? layout?.rows : wanted ? MAX_TAXI_ROWS : undefined
    const rows = roadRows !== undefined && meterFits(roadCols, roadRows, s.usd ?? 0) ? bandRows(s, t, l, x, dayKey(now), true) : full
    const { Box, Text } = $.ui.resolve(e)
    const text = rows.map(row => (
      <Text>
        {row.map(seg => (
          <Text color={seg.color} bold={seg.bold} dimColor={seg.dim}>
            {seg.text}
          </Text>
        ))}
      </Text>
    ))
    const frameBox = (road?: RenderElement, border = true) => (
      <Box flexDirection="column" borderStyle={border ? 'round' : undefined} borderColor="yellow" paddingX={1}>
        {road}
        {text}
      </Box>
    )

    // Another surface's drawing says nothing about the terminal's timer.
    if (!onTerminal) {
      if (roadRows === undefined) return frameBox()
      const { Svg } = $.ui.resolve(e)
      return frameBox(<Svg source={taxiSvg(x, s.usd ?? 0, roadCols, roadRows, now)} alt={`택시: ${taxiLabel(x, 100)}`} isInteractive={isTaxiAnimated(x) || undefined} />)
    }
    if (!layout) {
      stopAnim()
      return frameBox()
    }
    cols = roadCols
    taxiRows = layout.rows
    band = e.requestId
    scene.fareTo = s.usd ?? 0
    startAnim($, isMoving(scene, x))
    const { Raster } = $.ui.resolve(e)
    return frameBox(<Raster key={RASTER} columns={cols} rows={taxiRows} cells={taxiFrame(scene, x, cols, taxiRows)} />, layout.border)
  })
}
