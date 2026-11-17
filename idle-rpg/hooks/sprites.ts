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
}

/** The night scheme, the one drawn on a dark terminal. `star` dots its sky. */
export const SCENE = {
  sky: '#0d1220',
  star: '#2c3654',
  ground: '#3b4158',
  hill: '#1c2540', // far hills
  tree: '#18304a', // far trees
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

/** The four ordinary monsters, in the order game.ts names them. */
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
