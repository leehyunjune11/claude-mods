// The art, and nothing else. Edit this file to change how the game looks.
//
// A sprite is a list of rows, top to bottom; each character is one pixel and names a color in
// PALETTE, '.' being see-through. Every row of a sprite has the same length. The scene is 10 pixels
// tall with the ground on the last one, so a sprite is 9 rows at most. Sprites face each other: the
// hero looks right, monsters look left. FONT glyphs are 3 wide and 5 tall, '#' being ink.

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
}

export const SCENE = {
  sky: '#0d1220',
  star: '#2c3654',
  ground: '#3b4158',
  hp: '#e8483f',
  hpLost: '#3a1512',
  flash: '#ffffff',
  damage: '#f4f4f4',
  crit: '#ffd24a',
}

/** The hero standing; the two frames alternate. */
export const HERO_IDLE = [
  [
    '..sSSs....',
    '.sSBBSs.W.',
    '.sSSSSs.W.',
    '..RSSR..W.',
    '.sSSSSsYYY',
    '.sSSSSs.s.',
    '..S..S....',
    '.ss..ss...',
  ],
  [
    '..........',
    '..sSSs..W.',
    '.sSBBSs.W.',
    '.sSSSSs.W.',
    '..RSSR.YYY',
    '.sSSSSs.s.',
    '.sS..Ss...',
    '.ss..ss...',
  ],
]

/** One attack: the sword raised, then brought down in front. */
export const HERO_SWING = [
  [
    '..sSSs.W......',
    '.sSBBSsW......',
    '.sSSSSsW......',
    '..RSSRYYY.....',
    '.sSSSSs.......',
    '.sSSSSs.......',
    '..S..S........',
    '.ss...ss......',
  ],
  [
    '..sSSs........',
    '.sSBBSs....C..',
    '.sSSSSs.....C.',
    '..RSSRYWWWW.C.',
    '.sSSSSsY....C.',
    '.sSSSSs....C..',
    '..S...S.......',
    '.ss....ss.....',
  ],
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
