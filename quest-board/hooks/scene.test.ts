import { expect, test } from 'claude-code/testing'

import { SCENE_H, SCENE_W, heroPalette, monsterOf, sceneCells } from './scene'

test('전투 화면 셀 크기와 몬스터 고르기', async () => {
  const bytes = (b64: string) => atob(b64).length
  const want = SCENE_W * (SCENE_H / 2) * 3 * 4
  for (const monster of ['slime', 'mushroom', 'king', 'none'] as const) {
    expect(bytes(sceneCells({ monster, tick: 0 }))).toBe(want)
    expect(bytes(sceneCells({ monster, tick: 1, attackMs: 300, gain: { xp: 150, ms: 200 } }))).toBe(want)
    expect(bytes(sceneCells({ monster, tick: 16 }))).toBe(want) // 자동 공격 + 피해 숫자
  }
  expect(monsterOf('BOSS', true)).toBe('king')
  expect(monsterOf('메인', false)).toBe('mushroom')
  expect(monsterOf('잡몹', false)).toBe('slime')
  expect(monsterOf(undefined, undefined)).toBe('none')
})

test('캐릭터 색 덮어쓰기', async () => {
  const p = heroPalette({ hair: '#ff0000', eyes: 'nope' })
  expect(p.a).toBe(0xff0000)
  expect(p.A).toBe(0xad0000) // 그림자는 자동으로 어둡게
  expect(p.e).toBe(heroPalette().e) // 잘못된 값은 기본색
})
