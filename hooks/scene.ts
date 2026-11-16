// 입력창 위 픽셀아트 전투 화면. '▀' 한 칸 = 위아래 픽셀 2개 (fg=위, bg=아래)
export const SCENE_W = 136
// 왼쪽 게시판(베이지 판) 자리: 이 칸들 위에 글자가 겹쳐 그려진다
export const BOARD = { left: 136 - 47, width: 46 }
export const SCENE_H = 26 // 픽셀, 13줄

export type Monster = 'slime' | 'mushroom' | 'king' | 'none'

const OUTLINE = 0x1a1420

// 따뜻한 흙색 + 차분한 숲 초록 + 어두운 청록 그림자 (참고 이미지 색감)
const COLORS: Record<string, number> = {
  // 기사 (색은 HeroColors 로 바꿀 수 있음)
  a: 0x9b5fd0, // 머리
  A: 0x6a3a9a, // 머리 그림자
  s: 0xf2c79b, // 피부
  e: 0x1a1420, // 눈
  b: 0x33407a, // 옷
  B: 0x232a55, // 옷 그림자
  c: 0x7a2a3a, // 망토
  y: 0xe0b04a, // 장식
  w: 0xeef4f8, // 칼날
  g: 0xd8a040, // 손잡이
  k: 0x3a2a2a, // 장화
  u: 0xf0e6d2, // 셔츠
  l: 0x6a4028, // 벨트
  n: 0x2a2433, // 바지
  o: 0x2a1e2e, // 몬스터 눈
  S: 0x7a8aa8, // 방패 면
  x: 0x8a94a0, // 쇠 그림자 (도끼날)
  q: 0x8b5a2b, // 나무 (지팡이·활·도끼자루)
  m: 0x7ad8f8, // 마법 구슬
  z: 0xe8e0d0, // 활시위
  // 슬라임
  G: 0x6cc04a,
  L: 0xc4ec7a,
  D: 0x3d8a3a,
  // 버섯
  R: 0xc8463a,
  r: 0x8e2c2a,
  W: 0xf4e4c8,
  C: 0xefd9b0,
  // 킹슬라임
  K: 0xd0485a,
  P: 0xf08a8a,
  Q: 0x8e2c40,
  Y: 0xf2c14e,
  F: 0xffffff, // 피격 번쩍
}

// 직업: 몸은 같고, 들고 있는 것과 머리·옷 모양이 다르다
export type HeroClass = 'knight' | 'warrior' | 'mage' | 'ranger'
export const CLASS_NAME: Record<HeroClass, string> = { knight: '기사', warrior: '전사', mage: '마법사', ranger: '레인저' }
const RANGED: Record<HeroClass, boolean> = { knight: false, warrior: false, mage: true, ranger: true }

const BODY = [
  '..aaaaa...',
  '.aaaaaaa..',
  '.aassssaA.',
  '.asesesaA.',
  'aAssssssA.',
  'aA.sss.A..',
  'Acbuuubc..',
  'cbbuyuBbs.',
  'cbllyllB..',
  'c.bnnnB...',
  '..n...n...',
  '..n...n...',
  '.kk...kk..',
]
const BODY_LUNGE = [...BODY.slice(0, 10), '..n....n..', '.n......n.', 'kk.......kk']

type Layer = { sprite: string[]; dx: number; dy: number }

// 레이어를 한 장으로 합친다 (외곽선이 몸 위에 그려지지 않게 한 번에 칠하려고)
function compose(base: string[], layers: Layer[]): { rows: string[]; ox: number } {
  const all = [{ sprite: base, dx: 0, dy: 0 }, ...layers]
  const minX = Math.min(...all.map(l => l.dx))
  const minY = Math.min(...all.map(l => l.dy))
  const maxX = Math.max(...all.map(l => l.dx + Math.max(...l.sprite.map(r => r.length))))
  const maxY = Math.max(...all.map(l => l.dy + l.sprite.length))
  const grid = Array.from({ length: maxY - minY }, () => Array<string>(maxX - minX).fill('.'))
  for (const l of all)
    l.sprite.forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (c !== '.') grid[l.dy - minY + y]![l.dx - minX + x] = c
      }),
    )
  return { rows: grid.map(r => r.join('')), ox: -minX }
}

const SWORD_UP = ['.w.', '.w.', '.w.', '.w.', 'yyy', '.g.']
const SWORD_FWD = ['gywwwww']
const SHIELD = ['.yyy.', 'ySSSy', 'ySySy', 'ySSSy', '.ySy.', '..y..']
const AXE = ['.xw', 'xww', 'qxw', 'q..', 'q..', 'q..']
const AXE_BACK = ['wx.', 'wwx', 'wxq', '..q', '..q', '..q']
const AXE_FWD = ['....xw', 'qqqqww', '....xw']
const HAT = ['....b..', '...bb..', '..bbb..', '.bbbbb.', 'yyyyyyyyy']
const ROBE = ['.bbbbbBb.', '.bbbbbBb.', 'bbbbbbbBb', '.kk...kk.']
const STAFF = ['mm', 'mm', 'q.', 'q.', 'q.', 'q.', 'q.', 'q.', 'q.', 'q.']
const HOOD = ['..ccccc..', '.ccccccc.', '.c.......', 'c........']
const BOW = ['zq.', 'z.q', 'z.q', 'z.q', 'zq.']
const BOW_DRAWN = ['.q..', 'z.q.', '.z.q', 'z.q.', '.q..']
const HEADBAND = ['ccccccc']

export function heroSprite(cls: HeroClass, isAttacking: boolean): { rows: string[]; ox: number } {
  switch (cls) {
    case 'knight':
      return isAttacking
        ? compose(BODY_LUNGE, [{ sprite: SHIELD, dx: 7, dy: 6 }, { sprite: SWORD_FWD, dx: 7, dy: 5 }])
        : compose(BODY, [{ sprite: SWORD_UP, dx: -2, dy: 1 }, { sprite: SHIELD, dx: 7, dy: 6 }])
    case 'warrior':
      return isAttacking
        ? compose(BODY_LUNGE, [{ sprite: HEADBAND, dx: 1, dy: 1 }, { sprite: AXE_FWD, dx: 7, dy: 5 }, { sprite: AXE_FWD, dx: 6, dy: 8 }])
        : compose(BODY, [{ sprite: HEADBAND, dx: 1, dy: 1 }, { sprite: AXE_BACK, dx: -3, dy: 4 }, { sprite: AXE, dx: 8, dy: 4 }])
    case 'mage': {
      const base = [...BODY.slice(0, 9), ...ROBE]
      const staff = isAttacking ? STAFF.map(r => r.replace(/m/g, 'F')) : STAFF
      return compose(base, [{ sprite: HAT, dx: 0, dy: -4 }, { sprite: staff, dx: 9, dy: 2 }])
    }
    case 'ranger':
      return compose(BODY, [{ sprite: HOOD, dx: 0, dy: -1 }, { sprite: isAttacking ? BOW_DRAWN : BOW, dx: 9, dy: 4 }])
  }
}

const SLIME = [
  '....GGGG....',
  '..GGGGGGGG..',
  '.GLLGGGGGGG.',
  '.GLGGGGGGGG.',
  'GGGoGGGGoGGG',
  'GGGoGGGGoGGG',
  'GGGGGGGGGGGG',
  'DGGGGGGGGGGD',
  '.DDDDDDDDDD.',
]
const SLIME_SQUISH = [
  '............',
  '....GGGG....',
  '.GGLLGGGGGG.',
  'GGLGGGGGGGGG',
  'GGGoGGGGoGGG',
  'GGGoGGGGoGGG',
  'GGGGGGGGGGGG',
  'DGGGGGGGGGGD',
  'DDDDDDDDDDDD',
]
const MUSHROOM = [
  '....RRRR....',
  '..RRWWRRRR..',
  '.RRWWRRRWWR.',
  'RRRRRRRRWWRR',
  'RWWRRRRRRRRR',
  'rrrrrrrrrrrr',
  '...CCCCCC...',
  '...CoCCoC...',
  '...CCCCCC...',
  '...CCCCCC...',
  '..kk....kk..',
]
const MUSHROOM_BOB = ['............', ...MUSHROOM.slice(0, 9), '..kk....kk..']
const CROWN = ['..Y...Y...Y..', '..YYYYYYYYY..', '..YpYYwYYpY..']
const recolor = (rows: string[], map: Record<string, string>) =>
  rows.map(r => [...r].map(c => map[c] ?? c).join(''))
const scale = (rows: string[]) =>
  rows.flatMap(r => {
    const w = [...r].map(c => c + c).join('')
    return [w, w]
  })
const KING_COLORS = { G: 'K', L: 'P', D: 'Q' }
const KING = [...CROWN.map(r => '     ' + r), ...scale(recolor(SLIME, KING_COLORS).slice(2))]
const KING_SQUISH = [...CROWN.map(r => '     ' + r), ...scale(recolor(SLIME_SQUISH, KING_COLORS).slice(2))]

// 몬스터 색 변형: 퀘스트마다 다른 색 (id 해시로 고정)
const VARIANTS: Record<Exclude<Monster, 'none'>, Record<string, number>[]> = {
  slime: [
    { G: 0x6cc04a, L: 0xc4ec7a, D: 0x3d8a3a }, // 초록
    { G: 0x4a9ad8, L: 0xa8dcf8, D: 0x2a5a9a }, // 파랑
    { G: 0xe07ab0, L: 0xf8c0dc, D: 0x9a4078 }, // 분홍
    { G: 0xf0a040, L: 0xf8d890, D: 0xb06020 }, // 주황
    { G: 0x9a6ad8, L: 0xd0b0f4, D: 0x60409a }, // 보라
  ],
  mushroom: [
    { R: 0xc8463a, r: 0x8e2c2a }, // 빨강
    { R: 0x3a7ac8, r: 0x2a4a8e }, // 파랑
    { R: 0x8a4ac0, r: 0x5a2a80 }, // 보라
    { R: 0xd89a30, r: 0x9a6420 }, // 노랑
  ],
  king: [
    { K: 0xd0485a, P: 0xf08a8a, Q: 0x8e2c40 }, // 진홍
    { K: 0x3a3a7a, P: 0x7a7ac8, Q: 0x22224a }, // 남보라
    { K: 0x2a8a6a, P: 0x7ad0a8, Q: 0x1a5a44 }, // 청록
  ],
}

const seedHash = (seed: string) => [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

const MONSTER_SPRITES: Record<Exclude<Monster, 'none'>, [string[], string[]]> = {
  slime: [SLIME, SLIME_SQUISH],
  mushroom: [MUSHROOM, MUSHROOM_BOB],
  king: [KING, KING_SQUISH],
}

// 값이 같은 x 에 늘 같은 결과: 배경이 매 프레임 흔들리지 않게
const hash = (n: number) => {
  const x = Math.sin(n * 127.1) * 43758.5453
  return x - Math.floor(x)
}

export type Scheme = 'dark' | 'light'

// 다크 = 밤 숲, 라이트 = 구름 낀 낮 숲
const LOOK = {
  dark: {
    sky: [0x141a2a, 0x18223a, 0x1c2c40, 0x203646, 0x23404a, 0x26484c],
    far: 0x1f3d3a,
    pine: [0x2f5e36, 0x3e7a40, 0x5f9a48],
  },
  light: {
    sky: [0x4a9ad8, 0x5aa8e0, 0x6ab6e8, 0x7ec4ee, 0x92d0f2, 0xa8dcf6],
    far: 0x5a9a6a,
    pine: [0x2f7a3a, 0x3e9a48, 0x6ab85a],
  },
}

function clouds(px: Uint32Array, tick: number) {
  const W = SCENE_W
  for (const [base, y, w] of [[8, 2, 12], [46, 1, 16], [80, 3, 10], [100, 0, 14]] as const) {
    const cx = ((base + Math.floor(tick / 4)) % (W + 30)) - 15
    for (let dy = 0; dy < 4; dy++) {
      const half = Math.floor(w / 2) - (dy === 0 ? 3 : dy === 3 ? 1 : 0)
      for (let dx = -half; dx <= half; dx++) {
        const x = cx + dx
        const Y = y + dy
        if (x < 0 || x >= W) continue
        px[Y * W + x] = dy === 3 ? 0xd4e6f4 : 0xf6faff
      }
    }
  }
  // 해
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++)
      if (dx * dx + dy * dy <= 5) px[(3 + dy) * W + (60 + dx)] = 0xfff0a0
}

function background(px: Uint32Array, tick: number, scheme: Scheme) {
  const W = SCENE_W
  const ground = SCENE_H - 4
  const look = LOOK[scheme]
  const sky = look.sky
  for (let y = 0; y < ground; y++) {
    const c = sky[Math.min(sky.length - 1, Math.floor((y / ground) * sky.length))]!
    for (let x = 0; x < W; x++) px[y * W + x] = c
  }
  if (scheme === 'light') clouds(px, tick)
  // 먼 숲 실루엣
  for (let x = 0; x < W; x++) {
    const h = 5 + Math.round(2 * Math.sin(x / 5) + 1.5 * Math.sin(x / 2.3 + 1) + hash(x) * 1.5)
    for (let y = ground - h; y < ground; y++) px[y * W + x] = look.far
  }
  // 가까운 소나무
  for (const tx of [5, 17, 70, 82]) {
    const height = 11 + Math.round(hash(tx) * 3)
    for (let i = 0; i < height; i++) {
      const y = ground - 2 - i
      const half = Math.floor((height - i) / 2.6)
      for (let dx = -half; dx <= half; dx++) {
        const x = tx + dx
        if (x < 0 || x >= W || y < 0) continue
        px[y * W + x] = dx < 0 ? look.pine[0]! : dx === 0 && i % 3 === 0 ? look.pine[2]! : look.pine[1]!
      }
    }
    for (let y = ground - 2; y < ground; y++) if (tx < W) px[y * W + tx] = 0x5a3a24
  }
  // 덤불
  for (const bx of [11, 30, 62, 76]) {
    for (let dx = -3; dx <= 3; dx++) {
      const top = ground - (3 - Math.floor(Math.abs(dx) / 2))
      for (let y = top; y < ground; y++) {
        const x = bx + dx
        if (x >= 0 && x < W) px[y * W + x] = y === top ? 0x8cc152 : 0x5fa04a
      }
    }
  }
  // 땅: 풀 한 줄 + 흙길
  for (let x = 0; x < W; x++) {
    px[ground * W + x] = hash(x + 3) > 0.25 ? 0x6aa84f : 0x8cc152
    px[(ground + 1) * W + x] = hash(x + 7) > 0.6 ? 0x6aa84f : 0xb07040
    px[(ground + 2) * W + x] = hash(x + 11) > 0.8 ? 0xc88a58 : 0x9a5e36
    px[(ground + 3) * W + x] = hash(x + 13) > 0.85 ? 0x9a5e36 : 0x6e4028
  }
  if (scheme === 'light') return
  // 반딧불 (밤에만)
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(hash(i + 40) * W)
    const f = Math.floor(tick / 3)
    const y = 2 + Math.floor(hash(i + 90) * (ground - 6)) + ((f + i) % 3 === 0 ? -1 : 0)
    if ((f + i * 2) % 5 !== 0) px[y * W + x] = 0xf2e86a
  }
}

export type HeroColors = Partial<Record<'hair' | 'eyes' | 'skin' | 'outfit' | 'shirt' | 'pants' | 'cape' | 'trim', string>> & {
  heroClass?: HeroClass
}

const shade = (c: number) =>
  (Math.round(((c >> 16) & 255) * 0.68) << 16) | (Math.round(((c >> 8) & 255) * 0.68) << 8) | Math.round((c & 255) * 0.68)

// "#9b5fd0" → 팔레트 덮어쓰기. 잘못된 값은 무시하고 기본색
export function heroPalette(hero: HeroColors = {}): Record<string, number> {
  const hex = (v: string | undefined) => (v && /^#?[0-9a-f]{6}$/i.test(v) ? parseInt(v.replace('#', ''), 16) : undefined)
  const out = { ...COLORS }
  const set = (key: string, v: string | undefined, shadeKey?: string) => {
    const c = hex(v)
    if (c === undefined) return
    out[key] = c
    if (shadeKey) out[shadeKey] = shade(c)
  }
  set('a', hero.hair, 'A')
  set('e', hero.eyes)
  set('s', hero.skin)
  set('b', hero.outfit, 'B')
  set('u', hero.shirt)
  set('n', hero.pants)
  set('c', hero.cape)
  set('y', hero.trim)
  return out
}

function paint(px: Uint32Array, sprite: string[], x0: number, bottom: number, flash = false, colors = COLORS) {
  const y0 = bottom - sprite.length
  const at = (x: number, y: number) => sprite[y]?.[x]
  const isFilled = (x: number, y: number) => {
    const c = at(x, y)
    return c !== undefined && colors[c] !== undefined
  }
  const put = (x: number, y: number, color: number) => {
    const X = x0 + x
    const Y = y0 + y
    if (X >= 0 && X < SCENE_W && Y >= 0 && Y < SCENE_H) px[Y * SCENE_W + X] = color
  }
  const width = Math.max(...sprite.map(r => r.length))
  // 외곽선 먼저: 빈 칸인데 옆에 스프라이트가 있으면
  for (let y = -1; y <= sprite.length; y++) {
    for (let x = -1; x <= width; x++) {
      if (isFilled(x, y)) continue
      if (isFilled(x - 1, y) || isFilled(x + 1, y) || isFilled(x, y - 1) || isFilled(x, y + 1)) put(x, y, OUTLINE)
    }
  }
  sprite.forEach((row, y) =>
    [...row].forEach((c, x) => {
      const color = colors[c]
      if (color !== undefined) put(x, y, flash ? COLORS.F! : color)
    }),
  )
}

// 게시판: 나무 틀 + 베이지 종이, 다리가 땅에 박혀 있다
function board(px: Uint32Array) {
  const W = SCENE_W
  const x0 = BOARD.left
  const x1 = BOARD.left + BOARD.width - 1
  const y1 = SCENE_H - 3
  for (let y = 0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const isFrame = y < 2 || y >= y1 - 1 || x < x0 + 2 || x > x1 - 2
      const isFrameEdge = y === 0 || y === y1 || x === x0 || x === x1
      px[y * W + x] = isFrameEdge ? 0x4a2e1c : isFrame ? 0x9a5e36 : 0xe8d4a8
    }
  }
  // 다리
  for (const lx of [x0 + 4, x1 - 5]) {
    for (let y = y1 + 1; y < SCENE_H; y++) {
      px[y * W + lx] = 0x6e4028
      px[y * W + lx + 1] = 0x4a2e1c
    }
  }
}

const hpBar = (px: Uint32Array, x0: number, y: number, width: number, frac: number) => {
  for (let x = -1; x <= width; x++) {
    for (let dy = -1; dy <= 1; dy++) {
      const X = x0 + x
      const Y = y + dy
      if (X < 0 || X >= SCENE_W || Y < 0) continue
      const isEdge = x < 0 || x === width || dy !== 0
      px[Y * SCENE_W + X] = isEdge ? OUTLINE : x < Math.round(frac * width) ? 0xd04a3a : 0x3a2030
    }
  }
}

export type SceneOptions = {
  monster: Monster
  tick: number // 200ms 마다 1
  attackMs?: number // 체크로 처치 연출 시작 후 경과
  hero?: HeroColors
  seed?: string // 몬스터 색을 고르는 퀘스트 id
  gain?: { xp: number; ms: number } // 머리 위 +XP
  scheme?: Scheme
}

const IDLE_PERIOD = 15 // 3초마다 자동 공격 (방치형)
const HITS_PER_LIFE = 6

export function sceneCells(o: SceneOptions): string {
  const { monster, tick, attackMs, seed = '' } = o
  const heroColors = heroPalette(o.hero)
  const px = new Uint32Array(SCENE_W * SCENE_H)
  background(px, tick, o.scheme ?? 'dark')
  board(px)
  const ground = SCENE_H - 3
  const frame = Math.floor(tick / 3)

  const isAttacking = attackMs !== undefined && attackMs < 1200
  const phase = tick % IDLE_PERIOD
  const cls = o.hero?.heroClass ?? 'knight'
  const isRanged = RANGED[cls]
  // 근접은 앞으로 뛰어들고, 원거리는 제자리에서 쏜다. 맞는 순간(hitPhase)에 몬스터가 번쩍
  const hitPhase = isRanged ? 3 : 1
  const isSwinging = !isAttacking && monster !== 'none' && phase < (isRanged ? 3 : 2)
  const heroX = 26
  const isStriking = (isAttacking && attackMs! < 500) || isSwinging
  const lunge = isRanged ? 0 : isAttacking ? 10 : 5
  const sprite = heroSprite(cls, isStriking)
  paint(px, sprite.rows, heroX - sprite.ox + (isStriking ? lunge : 0), ground - (isStriking || isAttacking ? 0 : frame % 2), false, heroColors)

  const texts: { col: number; row: number; text: string; color: number }[] = []
  if (monster !== 'none') {
    const [idle, alt] = MONSTER_SPRITES[monster]
    const mx = monster === 'king' ? 46 : 52
    // 원거리 공격: 화살·마법 구슬이 날아간다
    const flight = isAttacking ? Math.min(3, Math.floor(attackMs! / 120)) : phase
    if (isRanged && (isSwinging || (isAttacking && attackMs! < 500)) && flight < 3) {
      const from = heroX + 12
      const x = Math.round(from + ((mx - from) * flight) / 3)
      const y = ground - 8
      const shot = cls === 'ranger' ? ['gwww'] : ['.mm.', 'mFFm', '.mm.']
      paint(px, shot, x, y + shot.length, false, heroColors)
    }
    const variants = VARIANTS[monster]
    const colors = { ...COLORS, ...variants[seedHash(seed) % variants.length] }
    const hits = Math.floor(tick / IDLE_PERIOD) % HITS_PER_LIFE
    if (!isAttacking) {
      paint(px, frame % 2 ? alt : idle, mx, ground, phase === hitPhase, colors)
      const width = Math.max(...idle.map(r => r.length))
      hpBar(px, mx, ground - idle.length - 3, width, 1 - hits / HITS_PER_LIFE)
      // 자동 공격 피해 숫자, 위로 떠오름
      if (phase >= hitPhase && phase < hitPhase + 6) {
        const dmg = 3 + Math.floor(hash(Math.floor(tick / IDLE_PERIOD)) * 9)
        const top = Math.floor((ground - idle.length - 3) / 2)
        texts.push({ col: mx + width - 2, row: Math.max(0, top - 1 - Math.floor((phase - hitPhase) / 2)), text: `-${dmg}`, color: o.scheme === 'light' ? 0xb13e53 : 0xffffff })
      }
    } else if (attackMs! < 800) paint(px, idle, mx + 2, ground, Math.floor(attackMs! / 100) % 2 === 0, colors)
  }

  // 체크 보상: 캐릭터 머리 위 초록 +XP
  if (o.gain && o.gain.ms < 1600) {
    const row = Math.max(0, 3 - Math.floor(o.gain.ms / 500))
    texts.push({ col: heroX - 1, row, text: `+${o.gain.xp}`, color: 0x7ee06a })
  }

  const words = new Uint32Array((SCENE_W * SCENE_H) / 2 * 3)
  for (let row = 0; row < SCENE_H / 2; row++) {
    for (let x = 0; x < SCENE_W; x++) {
      const i = (row * SCENE_W + x) * 3
      words[i] = 0x2580
      words[i + 1] = px[row * 2 * SCENE_W + x]!
      words[i + 2] = px[(row * 2 + 1) * SCENE_W + x]!
    }
  }
  // 글자 칸: 반블록 대신 글자, 배경은 그 칸 위쪽 픽셀 색
  for (const t of texts) {
    ;[...t.text].forEach((ch, k) => {
      const x = t.col + k
      if (x < 0 || x >= SCENE_W) return
      const i = (t.row * SCENE_W + x) * 3
      words[i] = ch.codePointAt(0)!
      words[i + 1] = t.color
      words[i + 2] = px[t.row * 2 * SCENE_W + x]!
    })
  }
  return toBase64(new Uint8Array(words.buffer))
}

function toBase64(bytes: Uint8Array) {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return btoa(s)
}

export function monsterOf(sec: string | undefined, boss: boolean | undefined): Monster {
  if (sec === undefined) return 'none'
  if (boss) return 'king'
  return sec === '메인' ? 'mushroom' : 'slime'
}

export const MONSTER_NAME: Record<Monster, string> = {
  slime: '슬라임',
  mushroom: '버섯',
  king: '킹슬라임',
  none: '',
}
