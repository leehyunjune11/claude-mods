// The art, and nothing else. Edit this file to change how the game looks.
//
// A sprite is a list of rows, top to bottom; each character is one pixel and names a color in
// PALETTE, '.' being see-through. Every row of a sprite has the same length. The scene is 10 pixels
// tall with the ground on the last one, so a sprite is 9 rows at most. Sprites face each other: the
// hero looks right, monsters look left. FONT glyphs are 3 wide and 5 tall, '#' being ink.
//
// The hero has a look per job (LOOKS). A line's frames are drawn once, in its own letters (A main,
// a its shade, T trim, M a glow), which each tier colors anew; and two letters only a higher tier
// draws: '~' a cape from 2차, '^' a crown or aura at 3차.

export const PALETTE: Record<string, string> = {
  K: '#14161c', // outline
  W: '#f4f4f4', // blade, eyes
  S: '#aab6c6', // armor
  s: '#5f6c80', // armor, shaded
  B: '#4aa3ff', // visor
  R: '#e8483f', // scarf, boss eyes
  Y: '#ffd24a', // sword guard
  C: '#9fe8ff', // slash trail, water
  c: '#3f9fc4', // water, shaded
  G: '#6fd36a', // bug
  g: '#2f8f4e', // bug, shaded
  P: '#b99cff', // ghost
  p: '#6f55c4', // ghost, shaded
  O: '#ff9d3c', // snake
  o: '#b85f1a', // snake, shaded
  N: '#8f867a', // stone
  n: '#565049', // stone, shaded
  H: '#f2c29b', // skin
  h: '#5a3a24', // hair
  D: '#a0662f', // wood: staff, bow, shield
  A: '#aab6c6', // a look's main color
  a: '#5f6c80', // a look's main color, shaded
  T: '#e8483f', // a look's trim
  M: '#ff7ae0', // a look's glow: orb, spark
  Q: '#b0302a', // cape (2차 up)
  X: '#f2c230', // crown, aura (3차)
  k: '#3a2a2a', // boots (the big scene)
  E: '#f0d070', // noodle
  e: '#b08a30', // noodle, shaded
  L: '#e8c030', // toad
  l: '#9a7a10', // toad, shaded
  V: '#7a5ab0', // bat
  v: '#45306a', // bat, shaded
  U: '#b8c4d8', // cloud
  u: '#7a8aa8', // cloud, shaded
  Z: '#ff7a2a', // flame
  z: '#c03a1a', // flame, shaded
  J: '#c0604a', // crab
  j: '#7a3a2a', // crab, shaded
}

/** The night scheme, the one drawn on a dark terminal. `star` dots its sky. */
export const SCENE = {
  sky: '#1a2236',
  star: '#4a5680',
  ground: '#3b4158',
  hill: '#273150', // far hills
  tree: '#1f3a50', // far trees
  hp: '#e8483f',
  hpLost: '#3a1512',
  flash: '#ffffff',
  damage: '#f4f4f4',
  crit: '#ffd24a',
}

/**
 * The day scheme, for a light terminal: clouds where the night has stars, and dark ink for
 * everything the night draws light, which a day sky would swallow (the blade, the flash, the
 * numbers, the guard, the slash).
 */
export const DAY_SCENE: typeof SCENE = {
  sky: '#9fd4f5',
  star: '#f4f9fd', // clouds
  ground: '#7fb35a',
  hill: '#8fc6b0',
  tree: '#5aa070',
  hp: '#d62f26',
  hpLost: '#f3cbc6',
  flash: '#1d2333',
  damage: '#1d2333',
  crit: '#b43c0a',
}
/** What the day draws in place of PALETTE's light colors. */
export const DAY_PALETTE: Record<string, string> = {
  W: '#3a4456',
  Y: '#8a5a00',
  C: '#1559b0',
  c: '#0d3f80',
}

export const SCHEMES = {
  dark: { scene: SCENE, palette: {} as Record<string, string> },
  light: { scene: DAY_SCENE, palette: DAY_PALETTE },
}
export type Scheme = keyof typeof SCHEMES

/** A line's frames before a tier colors them: two standing, two of an attack (raised, landed). */
type Frames = { idle: readonly string[][]; swing: readonly string[][] }

// The 인턴: a lanyard, a tie, and a rubber duck to debug with.
const INTERN: Frames = {
  idle: [
    [
      '...........',
      '...hhhh....',
      '..hhHKH....',
      '...HHHH....',
      '..AATAA....',
      '.HAATAAH...',
      '..aaaaa....',
      '..a...a....',
      '.KK...KK...',
    ],
    [
      '...........',
      '...........',
      '...hhhh....',
      '..hhHKH....',
      '...HHHH....',
      '.HAATAAH...',
      '..aaaaa....',
      '..a...a....',
      '.KK...KK...',
    ],
  ],
  swing: [
    [
      '.........YY....',
      '...hhhh.YYK....',
      '..hhHKH.YY.....',
      '...HHHHH.......',
      '..AATAA........',
      '..AATAA........',
      '..aaaaa........',
      '..a...a........',
      '.KK...KK.......',
    ],
    [
      '...............',
      '...hhhh........',
      '..hhHKH........',
      '...HHHH....C...',
      '..AATAAHHH.CYY.',
      '..AATAA...CYYK.',
      '..aaaaa....YY..',
      '..a....a.......',
      '.KK....KK......',
    ],
  ],
}

// 근접: plate, a shield on the near arm, a sword held up.
const MELEE: Frames = {
  idle: [
    [
      '...^^^^....',
      '...aAAa....',
      '..aABBAa.W.',
      '~.aAAAAa.W.',
      '~TTAAAAa.W.',
      '~TDTAAAaYYY',
      '~TTAAAAa.a.',
      '...A..A....',
      '..aa..aa...',
    ],
    [
      '...........',
      '...^^^^....',
      '...aAAa..W.',
      '~.aABBAa.W.',
      '~TTAAAAa.W.',
      '~TDTAAAaYYY',
      '~TTAAAAa.a.',
      '..aA..Aa...',
      '..aa..aa...',
    ],
  ],
  swing: [
    [
      '...^^^^.W......',
      '...aAAa.W......',
      '..aABBAaW......',
      '~.aAAAAYYY.....',
      '~TTAAAAa.......',
      '~TDTAAAa.......',
      '~TTAAAAa.......',
      '...A...A.......',
      '..aa...aa......',
    ],
    [
      '...^^^^........',
      '...aAAa........',
      '..aABBAa....C..',
      '~.aAAAAa.....C.',
      '~TTAAAAYWWWW.C.',
      '~TDTAAAaY....C.',
      '~TTAAAAa....C..',
      '...A....A......',
      '..aa....aa.....',
    ],
  ],
}

// 마법: a pointed hat, a robe, a staff with a glowing orb; the attack throws a bolt.
const MAGIC: Frames = {
  idle: [
    [
      '....a....^.',
      '...aA...MMM',
      '^..aAA..MMM',
      '..aTTTTa.D.',
      '...HKHK..D.',
      '~.aAAAAHHD.',
      '~.aAATAa.D.',
      '~aAAATAAaD.',
      '.aaaaTaaaD.',
    ],
    [
      '.........^.',
      '....a...MMM',
      '^..aA...MMM',
      '..aAAA...D.',
      '..aTTTTa.D.',
      '~..HKHKHHD.',
      '~.aAATAa.D.',
      '~aAAATAAaD.',
      '.aaaaTaaaD.',
    ],
  ],
  swing: [
    [
      '....a...MMM....',
      '...aA...MMM....',
      '^..aAA..HD.....',
      '..aTTTTaHD.....',
      '...HKHK..D.....',
      '~.aAAAA..D.....',
      '~.aAATAa.......',
      '~aAAATAAa......',
      '.aaaaTaaa......',
    ],
    [
      '....a..........',
      '...aA..........',
      '^..aAA......C..',
      '..aTTTTa...CMM.',
      '...HKHKHHDDMMMM',
      '~.aAAAAa...CMM.',
      '~.aAATAa....C..',
      '~aAAATAAa......',
      '.aaaaTaaa......',
    ],
  ],
}

// 원거리: a cap with a feather, a bow; the attack looses an arrow.
const RANGED: Frames = {
  idle: [
    [
      '...^.......',
      '...aAAA....',
      '..aAAAAa.D.',
      '...HKHK.D.S',
      '~..AAAA.D.S',
      '~.aATAAHD.S',
      '~.aAAAA.D.S',
      '...A..A..D.',
      '..aa..aa...',
    ],
    [
      '...........',
      '...^.......',
      '...aAAA..D.',
      '..aAAAAaD.S',
      '~..HKHK.D.S',
      '~.aATAAHD.S',
      '~.aAAAA.D.S',
      '..aA..A..D.',
      '..aa..aa...',
    ],
  ],
  swing: [
    [
      '...^...........',
      '...aAAA...D....',
      '..aAAAAa.S.D...',
      '...HKHK.S...D..',
      '~..AAAAHSDDDDW.',
      '~.aATAA.S...D..',
      '~.aAAAA..S.D...',
      '...A..A...D....',
      '..aa..aa.......',
    ],
    [
      '...^...........',
      '...aAAA...D....',
      '..aAAAAa..SD...',
      '...HKHK...S.D..',
      '~..AAAAHH.S.DCC',
      '~.aATAA...S.D..',
      '~.aAAAA...SD...',
      '...A..A...D....',
      '..aa..aa.......',
    ],
  ],
}

// 암살: a hood, eyes in its shadow, a dagger in each hand; the attack is a crossing slash.
const ROGUE: Frames = {
  idle: [
    [
      '^.........^',
      '...aAAa....',
      '..aAAAAa...',
      '..aKTKTa...',
      '~.aAAAAaHW.',
      '~WHAAAAa...',
      '~.aAAAAa...',
      '...a..a....',
      '..aa...aa..',
    ],
    [
      '...........',
      '^.........^',
      '...aAAa....',
      '..aAAAAa...',
      '~.aKTKTaHW.',
      '~WHAAAAa...',
      '~.aAAAAa...',
      '..aa..aa...',
      '.aa....aa..',
    ],
  ],
  swing: [
    [
      '^..............',
      '....aAAa.......',
      '...aAAAAa.W....',
      '...aKTKTaHW....',
      '~.aAAAAAa......',
      '~WHAAAAa.......',
      '~.aAAAAa.......',
      '..a....a.......',
      '.aa.....aa.....',
    ],
    [
      '^..............',
      '....aAAa...C...',
      '...aAAAAa...C..',
      '...aKTKTaHWWW.C',
      '~.aAAAAAaHWWW.C',
      '~..AAAAa....C..',
      '~.aAAAAa...C...',
      '..a.....a......',
      '.aa......aa....',
    ],
  ],
}

/** A line's frames as a tier draws them: the cape from 2차, the crown or aura at 3차. */
const dress = (frames: Frames, tier: number): Frames => {
  const put = (rows: readonly string[]) =>
    rows.map(row => row.replaceAll('~', tier >= 2 ? 'Q' : '.').replaceAll('^', tier >= 3 ? 'X' : '.'))
  return { idle: frames.idle.map(put), swing: frames.swing.map(put) }
}

export type Look = Frames & { colors: Record<string, string> }
const look = (frames: Frames, tier: number, colors: Record<string, string>): Look => ({ ...dress(frames, tier), colors })

/** Every look the hero has: the 인턴, then each line's 1차 to 3차, keyed as `<line><tier>`. */
export const LOOKS: Record<string, Look> = {
  intern: look(INTERN, 0, { A: '#6d93c4', a: '#3f4f6a', T: '#e8483f' }),
  melee1: look(MELEE, 1, {}),
  melee2: look(MELEE, 2, { A: '#7fa7d9', a: '#3f5f8f', T: '#c9a23c', Q: '#b0302a' }),
  melee3: look(MELEE, 3, { A: '#d7ae45', a: '#8a6a1c', T: '#b0302a', Q: '#7b2fbf', X: '#ff8a3c' }),
  magic1: look(MAGIC, 1, { A: '#7b5cd6', a: '#4f3a96', T: '#e0a030', M: '#ff7ae0' }),
  magic2: look(MAGIC, 2, { A: '#3a6fd8', a: '#24479a', T: '#e0a030', M: '#30d0e0', Q: '#7b5cd6' }),
  magic3: look(MAGIC, 3, { A: '#b03060', a: '#70203f', T: '#f2c230', M: '#ffb13c', Q: '#4a2a8a', X: '#ff7ae0' }),
  ranged1: look(RANGED, 1, { A: '#4f9a4a', a: '#2f6a2e', T: '#a0662f' }),
  ranged2: look(RANGED, 2, { A: '#2f9a8f', a: '#1d625a', T: '#e0a030', Q: '#2f6a2e' }),
  ranged3: look(RANGED, 3, { A: '#c0452f', a: '#7a2a1c', T: '#f2c230', Q: '#2f9a8f', X: '#f2c230' }),
  rogue1: look(ROGUE, 1, { A: '#6a7088', a: '#3c4054', T: '#e8483f' }),
  rogue2: look(ROGUE, 2, { A: '#3a5fa0', a: '#22386a', T: '#ff9d3c', Q: '#22386a' }),
  rogue3: look(ROGUE, 3, { A: '#5a3a8a', a: '#33204f', T: '#ff4fd8', Q: '#8a2f6a', X: '#b06bff' }),
}

/** The hero standing; the two frames alternate. The 근접 1차, 디버거 기사, as it always was. */
export const HERO_IDLE = LOOKS.melee1?.idle ?? []
/** One attack: the sword raised, then brought down in front. */
export const HERO_SWING = LOOKS.melee1?.swing ?? []

/** 전직 시험관: a proctor in a mortarboard, a monocle and a clipboard; it faces the hero. */
export const EXAMINER = [
  '..KKKKKKKK..',
  '....KKKK..Y.',
  '....HHHH..Y.',
  '...HWKHH....',
  '..pPPPPPPp..',
  '.DDPYPPYPPH.',
  '.DSDPPYPPp..',
  '.DDDPPYPPp..',
  '...pp..pp...',
]

/** The ordinary monsters, in the order game.ts names them (MOB_NAMES). */
export const MOBS = [
  // 세미콜론 벌레
  [
    '..K....K..',
    '...K..K...',
    '..GGGGGG..',
    '.GWKGGWKG.',
    '.GGGGGGGG.',
    '..gGGGGg..',
    '.g.gGGg.g.',
    '....gg....',
  ],
  // 널 유령
  [
    '..PPPPPP..',
    '.PPPPPPPP.',
    '.PKKPPKKP.',
    '.PKKPPKKP.',
    '.PPPPPPPP.',
    '.pPPKKPPp.',
    '.pPPPPPPp.',
    '.p.pp.pp..',
  ],
  // 무한루프 뱀
  [
    '....OOOOOO..',
    '...OO....OO.',
    'OO.O..OO..O.',
    'KOWO.O..O.O.',
    'RO...O.oo.O.',
    '.OO.OO...oo.',
    '..OOOoooooo.',
  ],
  // 메모리 누수 방울
  [
    '....C.....',
    '...CCC....',
    '..CCWCC...',
    '.CCWCCCC..',
    '.CKCCKCC..',
    '.CCCCCCc..',
    '..ccccc...',
    '.c...c..c.',
  ],
  [
    '...E.EE...',
    '..E.E..E..',
    '.EWKEEWKE.',
    'E.EEEEEEE.',
    '.ERReEEeE.',
    'E.RReEEeE.',
    '.e.E.e.E.e',
    'e..e..e..e',
  ],
  [
    '..........',
    '..LL..LL..',
    '.LKWLLKWL.',
    'LLLLLLLLLL',
    'LKLKLKLKLL',
    'lLLLLLLLLl',
    '.lLLllLLl.',
    'll......ll',
  ],
  [
    '............',
    'V..........V',
    'VV..vVVv..VV',
    'VVVvVRVRvVVV',
    '.VVVVVVVVVV.',
    '..V.vVVv.V..',
    '.....vv.....',
    '............',
  ],
  [
    '............',
    '....UUU.....',
    '..UUUUUUU...',
    '.UUKUUKUUUU.',
    'UUUUUUUUUUUU',
    'UUUUuuuUUUUU',
    '.uuuuuuuuuu.',
    '..u...u...u.',
  ],
  [
    '....Z....',
    '...ZZ..Z.',
    '..ZZYZ.Z.',
    '.ZZYYZZZ.',
    '.ZYKYKYZ.',
    'ZZYYYYYZZ',
    'ZzYYYYYzZ',
    '.zzzzzzz.',
  ],
  [
    '............',
    'JJ........JJ',
    'J.J......J.J',
    '.JJ.KJJK.JJ.',
    '..JJJJJJJJ..',
    '.JjYJJJJYjJ.',
    '.jJJJJJJJJj.',
    'j.j.j..j.j.j',
  ],
]

/** 레거시 골렘 */
export const BOSS = [
  '...NNNNNNN...',
  '..NNNNNNNNN..',
  '..NRRNNNRRN..',
  '.nNNNNNNNNNn.',
  'NNNnNNNNNnNNN',
  'NN.NNnnnNN.NN',
  'NN.NNNNNNN.NN',
  '...NNn.nNN...',
  '..nnn...nnn..',
]

/** Each monster's second frame, the one it shifts to on the off beat; MOBS's order and sizes. */
export const MOB_STEPS = [
  [
    '.K......K.',
    '..K....K..',
    '..GGGGGG..',
    '.GWKGGWKG.',
    '.GGGGGGGG.',
    '..gGGGGg..',
    'g..gGGg..g',
    '....gg....',
  ],
  [
    '..PPPPPP..',
    '.PPPPPPPP.',
    '.PKKPPKKP.',
    '.PKKPPKKP.',
    '.PPPPPPPP.',
    '.pPPPPPPp.',
    '.pPPKKPPp.',
    '..pp.pp.p.',
  ],
  [
    '....OOOOOO..',
    '...OO....OO.',
    'OO.O..OO..O.',
    'KOWO.O..O.O.',
    '.O...O.oo.O.',
    '.OO.OO..ooo.',
    '..OOOooooo..',
  ],
  [
    '..........',
    '....C.....',
    '..CCCCC...',
    '.CCWCCCCC.',
    '.CKCCKCCC.',
    'CCCCCCCcc.',
    '.cccccc...',
    '..c...c..c',
  ],
  [
    '....EE.E..',
    '..E..EE.E.',
    '.EWKEEWKE.',
    '.EEEEEEEE.',
    'E.RReEEeE.',
    '.ERReEEeE.',
    'e.E.e.E.e.',
    '.e..e..e..',
  ],
  [
    '..LL..LL..',
    '.LKWLLKWL.',
    'LLLLLLLLLL',
    'LKLKLKLKLL',
    'lLLLLLLLLl',
    '.lLLRRLLl.',
    '.l......l.',
    'l........l',
  ],
  [
    'VV........VV',
    '.VV......VV.',
    '..VVvVVvVV..',
    '...vVRVRv...',
    '...VVVVVV...',
    '....vVVv....',
    '.....vv.....',
    '............',
  ],
  [
    '.....UUU....',
    '...UUUUUUU..',
    '.UUUUUUUUUU.',
    '.UUKUUKUUUU.',
    'UUUUUUUUUUUU',
    'UUUUuuuUUUUU',
    '.uuuuuuuuuu.',
    '...u...u....',
  ],
  [
    '...Z..Z..',
    '..ZZ.ZZ..',
    '..ZYZZZ..',
    '.ZZYYYZZ.',
    '.ZYKYKYZ.',
    'ZZYYYYYZZ',
    'ZzYYYYYzZ',
    '.zzzzzzz.',
  ],
  [
    '.J........J.',
    'JJJ......JJJ',
    '.J.J....J.J.',
    '..J.KJJK.J..',
    '..JJJJJJJJ..',
    '.JjYJJJJYjJ.',
    '.jJJJJJJJJj.',
    '.j.j.jj.j.j.',
  ],
]

/** The golem's second frame: its fists up. */
export const BOSS_STEP = [
  'NN.........NN',
  'NN.NNNNNNN.NN',
  '.nNNNNNNNNNn.',
  '..NRRNNNRRN..',
  '..NNNNNNNNN..',
  '...NNnnnNN...',
  '...NNNNNNN...',
  '...NNn.nNN...',
  '..nnn...nnn..',
]

/**
 * The colors a monster wears by stage, in MOBS's order then the golem's: a stage takes the next
 * one round, the first being PALETTE's own. None is near white, which a day sky would swallow.
 */
export const TINTS: Record<string, string>[][] = [
  [{}, { G: '#e0c040', g: '#9a7a1c' }, { G: '#e06a6a', g: '#9a2f3a' }, { G: '#5ab0e0', g: '#2f6a9a' }],
  [{}, { P: '#5fc7a0', p: '#2f8a6a' }, { P: '#f09ac0', p: '#b04a7a' }, { P: '#9aa4b4', p: '#5a6274' }],
  [{}, { O: '#6fd36a', o: '#2f8f4e' }, { O: '#c07ae0', o: '#7a3a9a' }, { O: '#e0c040', o: '#9a7a1c' }],
  [{}, { C: '#ff9d3c', c: '#b85f1a' }, { C: '#ff7ae0', c: '#a03a8a' }, { C: '#7fd06a', c: '#3f8a3a' }],
  [{}, { E: '#e8a050', e: '#a0602a' }, { E: '#d8e070', e: '#8a9a2a' }, { E: '#f0b0a0', e: '#b05a4a' }],
  [{}, { L: '#7fd06a', l: '#3f8a3a' }, { L: '#ff9d3c', l: '#b85f1a' }, { L: '#5ab0e0', l: '#2f6a9a' }],
  [{}, { V: '#5a7ab0', v: '#2f456a' }, { V: '#b05a7a', v: '#6a2f45' }, { V: '#6a6a6a', v: '#3a3a3a' }],
  [{}, { U: '#c8b8d8', u: '#8a7aa8' }, { U: '#b8d8c8', u: '#7aa88a' }, { U: '#d8c8b8', u: '#a88a7a' }],
  [{}, { Z: '#5ab0ff', z: '#2a5ac0' }, { Z: '#c07aff', z: '#7a3ac0' }, { Z: '#7fd06a', z: '#3f8a3a' }],
  [{}, { J: '#6a86a6', j: '#3a4a60' }, { J: '#7f9060', j: '#4a5233' }, { J: '#a07ac0', j: '#5a3a7a' }],
  [{}, { N: '#9a7650', n: '#5a4030' }, { N: '#6a86a6', n: '#3a4a60' }, { N: '#7f9060', n: '#4a5233' }],
]

/** Damage numbers: the digits, and K for thousands. */
export const FONT: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  E: ['###', '#..', '##.', '#..', '###'],
}

// --- The big scene: 18 pixels tall, the ground on the last. The hero is drawn at about twice the
// small one's detail: one body, and over it what each line wears and holds, laid by `frame`. Every
// frame is the same 24 by 17 canvas with the body's top left at (2, 2), so the feet never move.

/** A sprite and where its top left goes, the body's top left being (0, 0). */
type Layer = readonly [rows: readonly string[], dx: number, dy: number]
const CANVAS = { w: 24, h: 17, x: 2, y: 2 }

/** Lays the layers on the canvas in order, later ones on top; what falls off it is dropped. */
const canvas = (layers: readonly Layer[]) => {
  const grid = Array.from({ length: CANVAS.h }, () => Array<string>(CANVAS.w).fill('.'))
  for (const [rows, dx, dy] of layers) {
    rows.forEach((row, j) => {
      ;[...row].forEach((c, i) => {
        const line = grid[CANVAS.y + dy + j]
        const x = CANVAS.x + dx + i
        if (c !== '.' && line && x >= 0 && x < CANVAS.w) line[x] = c
      })
    })
  }
  return grid.map(row => row.join(''))
}

/** The rows a sprite takes, each a pixel row twice and each pixel twice. */
export const scale2 = (rows: readonly string[]) =>
  rows.flatMap(row => {
    const wide = [...row].map(c => c + c).join('')
    return [wide, wide]
  })

/** The sprite turned to face the other way. */
const mirror = (rows: readonly string[]) => rows.map(row => [...row].reverse().join(''))

/** The sprite less the columns nothing is drawn in, at either side. */
const trim = (rows: readonly string[]) => {
  const used = (i: number) => rows.some(row => row[i] !== '.')
  const wide = rows[0]?.length ?? 0
  let from = 0
  let to = wide
  while (from < to && !used(from)) from++
  while (to > from && !used(to - 1)) to--
  return rows.map(row => row.slice(from, to))
}

// The body, facing right: the back hand at (1, 9); the front hand is a layer, it moves.
const BODY = [
  '...hhhhh..',
  '..hhhhhhh.',
  '..hhHHHHh.',
  '..hHHKHKH.',
  '...HHHHH..',
  '....HHH...',
  '..AAAAAA..',
  '.AAAATAAA.',
  '.AAAATAAa.',
  '.HAAATAa..',
  '..TTTTTT..',
  '..aaaaaa..',
  '..aa..aa..',
  '..aa..aa..',
  '..kkk.kkk.',
]
/** The off beat: all but the feet a pixel lower. */
const BODY_BOB = ['..........', ...BODY.slice(0, 12), ...BODY.slice(13)]
/** Mid-attack: the feet apart. */
const BODY_LUNGE = [...BODY.slice(0, 12), '.aa....aa.', 'aa......aa', 'kk......kk']

const HAND: Layer = [['H'], 8, 9]
const RAISE: Layer = [['.H', 'a.'], 8, 5]
const FORWARD: Layer = [['aH'], 9, 8]
const CAPE: Layer = [['.~', '~~', '~~', '~~', '~~', '~~', '~~.', '~~~'], -1, 6]
const CROWN: Layer = [['^.^.^', '^^^^^'], 3, -2]
const SPARKS: Layer[] = [[['^'], -1, 1], [['^'], 11, -1], [['^'], -2, 9], [['^'], 12, 12]]

/** A layer list a pixel lower, for the off beat. */
const lower = (layers: readonly Layer[], by: number) => layers.map(([rows, dx, dy]): Layer => [rows, dx, dy + by])

/**
 * A line's four frames: the cape and `under` behind the body, `wear` on it in every frame, and in
 * each frame what the hands do. `lunge` spreads the feet for the attack (a robe hides them).
 */
const bigLine = (p: { under?: Layer[]; wear: Layer[]; idle: Layer[]; raised: Layer[]; landed: Layer[]; lunge?: boolean }): Frames => {
  const under = [CAPE, ...(p.under ?? [])]
  const legs = p.lunge === false ? BODY : BODY_LUNGE
  const frame = (body: readonly string[], over: readonly Layer[], by = 0) =>
    canvas([...lower(under, by), [body, 0, 0], ...lower([...p.wear, ...over], by)])
  return {
    idle: [frame(BODY, p.idle), frame(BODY_BOB, p.idle, 1)],
    swing: [frame(legs, p.raised), frame(legs, p.landed)],
  }
}

const SWORD = ['.W.', '.W.', '.W.', '.W.', '.W.', 'YYY', '.D.']
const BIG_MELEE = bigLine({
  wear: [
    [['...AAAAA..', '..AAAAAAA.', '..aAAAAAA.', '..aABBBBA.'], 0, 0],
    [['.TTT.', 'TTDTT', 'TDDDT', 'TTDTT', '.TTT.', '..T..'], -2, 7],
    CROWN,
  ],
  idle: [[SWORD, 7, 3], HAND],
  raised: [[SWORD, 8, -1], RAISE],
  landed: [FORWARD, [['YWWWWWW'], 11, 8], [['C.', '.C', '.C', '.C', 'C.'], 18, 6]],
})

const STAFF = ['MMM', 'MMM', ...Array<string>(13).fill('.D.')]
const BIG_MAGIC = bigLine({
  wear: [
    [['....a.....', '....aA....', '...aAAA...', '..aAAAAA..', '.TTTTTTTTT'], 0, -2],
    [['..aATAAA..', '.aAATAAAA.', '.aAATAAAA.', 'aAAAATAAAA'], 0, 10],
    ...SPARKS,
  ],
  idle: [[STAFF, 8, -1], HAND],
  raised: [[STAFF, 8, -2], RAISE, [['C.C', '...', 'C.C'], 8, -2]],
  landed: [FORWARD, [['......MM', 'DDDDDDMM'], 8, 7], [['..CMM.', 'CCMMMM', '..CMM.'], 16, 6]],
  lunge: false,
})

const BOW = ['SD.', 'S.D', 'S.D', 'S.D', 'S.D', 'S.D', 'S.D', 'S.D', 'SD.']
const BIG_RANGED = bigLine({
  wear: [[['...AAAA...', '..AAAAAAA.', '..aAAAAAAA'], 0, 0], [['T', 'T', 'T'], 1, -1], CROWN],
  idle: [[BOW, 9, 5], HAND],
  raised: [FORWARD, [BOW, 11, 4], [['DDDDDDW'], 8, 8]],
  landed: [FORWARD, [BOW, 11, 4], [['CCDDDW'], 15, 8]],
})

const DAGGER = ['W', 'W', 'D']
const BIG_ROGUE = bigLine({
  wear: [
    [['...aAAAa..', '..aAAAAAa.', '..aAAAAAA.', '..aAKTKTA.', '..aAKKKKA.', '...aAAA...'], 0, 0],
    [DAGGER, 1, 6],
    ...SPARKS,
  ],
  idle: [[DAGGER, 8, 7], HAND],
  raised: [[DAGGER, 9, 2], RAISE],
  landed: [FORWARD, [['WW'], 11, 8], [['C...C', '.C.C.', '..C..', '.C.C.', 'C...C'], 14, 6]],
})

const DUCK = ['.YY.', '.YKR', 'YYYY', '.YY.']
const BIG_INTERN = bigLine({
  wear: [],
  idle: [HAND],
  raised: [[DUCK, 8, 1], RAISE],
  landed: [FORWARD, [['CC'], 12, 8], [DUCK, 14, 6]],
})

/** The big scene's looks, keyed as LOOKS is and colored the same. */
export const BIG_LOOKS: Record<string, Look> = Object.fromEntries(
  Object.entries(LOOKS).map(([id, small]) => {
    const line = id.replace(/\d$/, '')
    const tier = Number(id.at(-1)) || 0
    const frames = { melee: BIG_MELEE, magic: BIG_MAGIC, ranged: BIG_RANGED, rogue: BIG_ROGUE }[line] ?? BIG_INTERN
    return [id, look(frames, tier, small.colors)]
  }),
)

/** The examiner at the hero's size: a gown, a mortarboard, a monocle and a clipboard; facing left. */
export const BIG_EXAMINER = trim(
  mirror(
    canvas([
      [BODY.map(row => row.replaceAll('A', 'P').replaceAll('a', 'p').replaceAll('T', 'Y')), 0, 0],
      [['KKKKKKKKKKK', '..KKKKKK.Y.', '.........Y.'], -1, -1],
      [['W'], 7, 3],
      [['DDDD', 'DSSD', 'DSSD', 'DSSD', 'DDDD'], 7, 7],
      HAND,
    ]),
  ),
)

const BOSS_CROWN = ['Y....Y....Y', 'YY..YYY..YY', 'YYYYYRYYYYY'].map(row => `.......${row}........`)
/** The golem twice the size, crowned: its eyes flare gold on the off beat. */
export const BIG_BOSS = [...BOSS_CROWN, ...scale2(BOSS.slice(2))]
export const BIG_BOSS_STEP = [...BOSS_CROWN, ...scale2(BOSS.slice(2).map(row => row.replaceAll('R', 'Y')))]

/**
 * Each zone's sky, hills, trees and ground over the scheme's own (game.ts's ZONES, in order): the
 * first is the scheme as it stands. The day's clouds stay the one near white.
 */
export const ZONE_SCENES: { dark: Partial<typeof SCENE>; light: Partial<typeof SCENE> }[] = [
  { dark: {}, light: {} },
  {
    dark: { sky: '#1b2a26', star: '#3f5a50', hill: '#25382f', tree: '#2f4a30', ground: '#4a4a30' },
    light: { sky: '#b8d4a8', hill: '#8fb07a', tree: '#5a8a4a', ground: '#8a7a4a' },
  },
  {
    dark: { sky: '#1e2a44', star: '#5a6890', hill: '#2e3d5c', tree: '#2a4a5a', ground: '#5a6478' },
    light: { sky: '#b6d8f4', hill: '#cfdcec', tree: '#7aa8c0', ground: '#a0b0c0' },
  },
  {
    dark: { sky: '#341c22', star: '#6a3a44', hill: '#442224', tree: '#542a24', ground: '#5a3020' },
    light: { sky: '#f0c8a8', hill: '#d89a7a', tree: '#a05a3a', ground: '#8a4a2a' },
  },
]
